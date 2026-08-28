package contract

import (
	"encoding/hex"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
)

/*
This file is the plugin's OWN HTTP server, where this chain exposes its custom, chain-specific
read endpoints. Canopy core only offers a single generic, read-only transport over the unix
socket — Plugin.QueryState(height, read), which returns raw key/value state at a historical
height (0 = latest committed). The plugin process owns this HTTP server entirely, decodes its
own keys and protobufs, and shapes the JSON however it likes. Canopy never needs to know these
routes exist.

The guestbook exposes:

	GET /v1/query/posts                       list posts, newest first
	GET /v1/query/posts?id=7                  fetch a single post by id
	GET /v1/query/posts?author=<hex>          only posts by one author
	GET /v1/query/posts?limit=50&reverse=false&height=42
	GET /v1/query/post-counter                how many posts exist / which id is next
	GET /v1/health                            liveness plus the running build marker

The listen address comes from the 'rpcAddress' config field (default 0.0.0.0:50010).
*/

// defaultPostLimit caps an unbounded /v1/query/posts request so a large guestbook can never
// return the entire feed in one response by accident.
const defaultPostLimit = 100

// jsonPost is the wire shape of a Post. The address is rendered as hex (matching how Canopy's own
// RPC renders addresses) rather than the base64 that protojson would emit for a bytes field.
type jsonPost struct {
	Id            uint64 `json:"id"`
	AuthorAddress string `json:"authorAddress"`
	Content       string `json:"content"`
	Height        uint64 `json:"height"`
}

// StartRPCServer() launches the plugin's own HTTP server and registers the guestbook's read
// endpoints, each backed by the detached, read-only QueryState() path.
func (p *Plugin) StartRPCServer() {
	// resolve the listen address from config
	addr := p.config.RPCAddress
	// if no address is configured, the RPC server is disabled
	if addr == "" {
		log.Println("plugin RPC server disabled (no rpcAddress configured)")
		return
	}
	// build the router and register the guestbook routes
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/query/posts", p.handleQueryPosts)
	mux.HandleFunc("/v1/query/post-counter", p.handleQueryPostCounter)
	mux.HandleFunc("/v1/health", p.handleHealth)
	// log the build marker so the running version is obvious in the log
	log.Printf("plugin RPC server (%s) listening on %s: /v1/query/posts, /v1/query/post-counter, /v1/health", GuestbookBuild, addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Printf("plugin RPC server error: %v", err)
	}
}

// withCORS() permits browser frontends served from another origin (the dev server on :5173, say) to
// read these endpoints. Everything here is public, read-only chain state, and the node's own RPC
// applies the same permissive policy, so there is nothing to protect with an origin restriction.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		// answer the preflight without touching state
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// handleQueryPosts() serves the guestbook feed.
func (p *Plugin) handleQueryPosts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "only GET is supported")
		return
	}
	query := r.URL.Query()
	// height 0 means 'latest committed state'
	height, err := parseUint(query.Get("height"), 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid height: "+err.Error())
		return
	}
	// ?id=<n> selects a single post via an exact key read
	if raw := query.Get("id"); raw != "" {
		id, e := parseUint(raw, 0)
		if e != nil || id == 0 {
			writeErr(w, http.StatusBadRequest, "invalid id: post ids start at 1")
			return
		}
		p.servePostByID(w, height, id)
		return
	}
	// otherwise iterate the post prefix
	limit, err := parseUint(query.Get("limit"), defaultPostLimit)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid limit: "+err.Error())
		return
	}
	// newest first by default: that is the order a feed wants to render
	reverse := true
	if raw := query.Get("reverse"); raw != "" {
		reverse, err = strconv.ParseBool(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid reverse: expected true or false")
			return
		}
	}
	// an optional author filter, applied after decoding
	var author []byte
	if raw := strings.TrimPrefix(query.Get("author"), "0x"); raw != "" {
		author, err = hex.DecodeString(raw)
		if err != nil || len(author) != 20 {
			writeErr(w, http.StatusBadRequest, "invalid author: expected a 20 byte hex address")
			return
		}
	}
	// when filtering by author, the limit applies to matches rather than to raw records, so the
	// range read itself has to stay unbounded (limit 0 = no limit) and the cap is applied below
	rangeLimit := limit
	if author != nil {
		rangeLimit = 0
	}
	response, qErr := p.QueryState(height, &PluginStateReadRequest{
		Ranges: []*PluginRangeRead{
			{QueryId: rand.Uint64(), Prefix: PostPrefix(), Limit: rangeLimit, Reverse: reverse},
		}})
	if qErr != nil {
		writeQueryErr(w, qErr)
		return
	}
	posts := make([]jsonPost, 0)
	for _, result := range response.Results {
		for _, entry := range result.Entries {
			// skip the empty values a deleted key can leave behind
			if len(entry.Value) == 0 {
				continue
			}
			post := new(Post)
			if e := Unmarshal(entry.Value, post); e != nil {
				log.Printf("skipping undecodable post at key %x: %s", entry.Key, e.Error())
				continue
			}
			if author != nil && !equalBytes(post.AuthorAddress, author) {
				continue
			}
			posts = append(posts, toJSONPost(post))
			if limit != 0 && uint64(len(posts)) >= limit {
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts, "count": len(posts), "height": height})
}

// servePostByID() serves a single post through an exact key read.
func (p *Plugin) servePostByID(w http.ResponseWriter, height, id uint64) {
	response, qErr := p.QueryState(height, &PluginStateReadRequest{
		Keys: []*PluginKeyRead{{QueryId: rand.Uint64(), Key: KeyForPost(id)}},
	})
	if qErr != nil {
		writeQueryErr(w, qErr)
		return
	}
	for _, result := range response.Results {
		for _, entry := range result.Entries {
			if len(entry.Value) == 0 {
				continue
			}
			post := new(Post)
			if e := Unmarshal(entry.Value, post); e != nil {
				writeErr(w, http.StatusInternalServerError, "failed to decode post: "+e.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"post": toJSONPost(post), "height": height})
			return
		}
	}
	writeErr(w, http.StatusNotFound, "no post with that id")
}

// handleQueryPostCounter() reports how many posts the guestbook holds and which id comes next.
func (p *Plugin) handleQueryPostCounter(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "only GET is supported")
		return
	}
	height, err := parseUint(r.URL.Query().Get("height"), 0)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid height: "+err.Error())
		return
	}
	response, qErr := p.QueryState(height, &PluginStateReadRequest{
		Keys: []*PluginKeyRead{{QueryId: rand.Uint64(), Key: KeyForPostCounter()}},
	})
	if qErr != nil {
		writeQueryErr(w, qErr)
		return
	}
	counter := new(PostCounter)
	for _, result := range response.Results {
		for _, entry := range result.Entries {
			if len(entry.Value) == 0 {
				continue
			}
			if e := Unmarshal(entry.Value, counter); e != nil {
				writeErr(w, http.StatusInternalServerError, "failed to decode post counter: "+e.Error())
				return
			}
		}
	}
	// ids start at 1, so an absent counter means the next post is post 1 and none exist yet
	nextId := counter.NextId
	if nextId == 0 {
		nextId = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{"nextId": nextId, "totalPosts": nextId - 1, "height": height})
}

// handleHealth() reports liveness and the running build, so an operator or the UI can confirm which
// plugin binary is actually serving without reading the log.
func (p *Plugin) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":            "ok",
		"build":             GuestbookBuild,
		"chainId":           p.config.ChainId,
		"maxContentLength":  MaxPostContentLength,
		"postMessageTxType": "post_message",
	})
}

/* ---------------------------------- helpers ---------------------------------- */

func toJSONPost(post *Post) jsonPost {
	return jsonPost{
		Id:            post.Id,
		AuthorAddress: hex.EncodeToString(post.AuthorAddress),
		Content:       post.Content,
		Height:        post.Height,
	}
}

// parseUint() parses an optional uint64 query parameter, returning def when it is absent.
func parseUint(raw string, def uint64) (uint64, error) {
	if raw == "" {
		return def, nil
	}
	return strconv.ParseUint(raw, 10, 64)
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("failed to write RPC response: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": message})
}

// writeQueryErr() translates a QueryState failure into an HTTP response. A node that has not
// committed a block yet cannot serve a snapshot at all, which is a normal startup condition rather
// than a server fault, so it is reported as 503 to tell clients to retry.
func writeQueryErr(w http.ResponseWriter, err *PluginError) {
	log.Printf("QueryState failed: %s", err.Error())
	writeErr(w, http.StatusServiceUnavailable, "state query failed: "+err.Msg)
}
