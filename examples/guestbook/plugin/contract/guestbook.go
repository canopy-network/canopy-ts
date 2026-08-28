package contract

import (
	"math"
	"math/rand"
	"unicode/utf8"
)

/*
This file contains the guestbook application logic layered on top of the base plugin.

The guestbook adds one custom transaction type, 'post_message', which appends an immutable
entry to an on-chain, append-only feed. Every accepted entry is stored as a 'Post' record
carrying a chain-assigned auto-incrementing id, the author's address, the content, and the
block height at which it was applied.

Two plugin-owned state prefixes are used, both outside the core-reserved range 1-15:

	100 -> Post        (one record per entry, keyed by big-endian id)
	101 -> PostCounter (a single record holding the id for the next entry)

Both are declared in ContractConfig.CustomStatePrefixes so Canopy validates them at handshake.
*/

// MaxPostContentLength is the maximum length of a guestbook entry, counted in unicode code
// points rather than bytes so that the limit means the same thing to the UI (which counts
// characters) and to consensus. Both utf8.ValidString and utf8.RuneCountInString are pure
// functions of the UTF-8 encoding — they consult no Unicode tables — so this bound stays
// deterministic across Go versions and across validators.
const MaxPostContentLength = 280

// GuestbookBuild is a human-readable marker for the guestbook layer, reported by /v1/health and
// logged at startup so an operator can confirm which plugin binary is actually serving.
const GuestbookBuild = "canopy-guestbook v1 (post_message + /v1/query/posts)"

/* ------------------------------------------------------------------ *
 *  STATE KEYS                                                        *
 * ------------------------------------------------------------------ */

var (
	postPrefix        = []byte{100} // store key prefix for guestbook posts
	postCounterPrefix = []byte{101} // store key prefix for the guestbook post counter
)

// PostPrefix() returns the length-prefixed key prefix that every post key starts with. It is the
// prefix to hand to a range read in order to iterate the whole guestbook.
func PostPrefix() []byte {
	return JoinLenPrefix(postPrefix)
}

// KeyForPost() returns the state database key for a single post. The id is encoded big-endian so
// that the store's lexicographic key order is also numeric id order: a forward range scan yields
// the oldest post first and a reverse scan yields the newest first, without sorting in the plugin.
func KeyForPost(id uint64) []byte {
	return JoinLenPrefix(postPrefix, formatUint64(id))
}

// KeyForPostCounter() returns the state database key of the singleton counter record that holds the
// id to assign to the next accepted post.
func KeyForPostCounter() []byte {
	return JoinLenPrefix(postCounterPrefix, []byte("/c/"))
}

/* ------------------------------------------------------------------ *
 *  CHECK TX (stateless)                                              *
 * ------------------------------------------------------------------ */

// CheckMessagePost() statelessly validates a 'post_message' message.
//
// This runs during mempool admission, BEFORE the transaction is included in a block, so it may not
// read state — every check here is a pure function of the message itself. The stateful part (does
// the author actually have the funds to pay the fee?) belongs to DeliverMessagePost.
func (c *Contract) CheckMessagePost(msg *MessagePost) *PluginCheckResponse {
	// validate the author address - all Canopy addresses are exactly 20 bytes (the first 20 bytes
	// of the SHA256 of the public key). This keeps malformed addresses out of the mempool.
	if len(msg.AuthorAddress) != 20 {
		return &PluginCheckResponse{Error: ErrInvalidAddress()}
	}
	// reject content that is not valid UTF-8; without this, RuneCountInString would count each
	// invalid byte as one replacement rune and the length bound would depend on the encoding
	if !utf8.ValidString(msg.Content) {
		return &PluginCheckResponse{Error: ErrInvalidPostContent()}
	}
	// an empty entry carries no information and would just consume block space. Note this is a
	// byte-length check on purpose: a whitespace-only check would depend on the Unicode space
	// tables of whichever Go version a validator built with. The UI trims before submitting.
	if len(msg.Content) == 0 {
		return &PluginCheckResponse{Error: ErrEmptyPostContent()}
	}
	// enforce the 280 character bound, counted in code points
	if utf8.RuneCountInString(msg.Content) > MaxPostContentLength {
		return &PluginCheckResponse{Error: ErrPostContentTooLong()}
	}
	// a guestbook entry has no recipient, so Recipient is deliberately left nil (as it is for core
	// messages like 'unstake'); it is only used for indexing. The author must sign: they are the
	// one being quoted on-chain forever and they pay the fee.
	return &PluginCheckResponse{AuthorizedSigners: [][]byte{msg.AuthorAddress}}
}

/* ------------------------------------------------------------------ *
 *  DELIVER TX (stateful)                                             *
 * ------------------------------------------------------------------ */

// DeliverMessagePost() applies a 'post_message' message: it charges the author the transaction fee
// and appends a new Post record to the guestbook under the next auto-incrementing id.
//
// 'height' is the height of the block being applied, taken from PluginDeliverRequest.Height. That
// is the deterministic source: it is supplied by the FSM with the request itself, so every
// validator stamps the same height onto the same post regardless of how the plugin's handler
// goroutines happen to interleave.
func (c *Contract) DeliverMessagePost(msg *MessagePost, fee, height uint64) *PluginDeliverResponse {
	var (
		authorKey, feePoolKey, counterKey         = KeyForAccount(msg.AuthorAddress), KeyForFeePool(c.Config.ChainId), KeyForPostCounter()
		authorBytes, feePoolBytes, counterBytes   []byte
		authorQueryId, feeQueryId, counterQueryId = rand.Uint64(), rand.Uint64(), rand.Uint64()
		author, feePool, counter                  = new(Account), new(Pool), new(PostCounter)
	)
	// batch every read into a single round trip to the FSM: the author's account (they pay the
	// fee), the fee pool (it receives the fee), and the counter (it assigns the id)
	response, err := c.plugin.StateRead(c, &PluginStateReadRequest{
		Keys: []*PluginKeyRead{
			{QueryId: counterQueryId, Key: counterKey},
			{QueryId: authorQueryId, Key: authorKey},
			{QueryId: feeQueryId, Key: feePoolKey},
		}})
	// handle a transport level error
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	// handle an application level error from the FSM
	if response.Error != nil {
		return &PluginDeliverResponse{Error: response.Error}
	}
	// match each result back to its request by query id; results may arrive in any order
	for _, resp := range response.Results {
		if len(resp.Entries) == 0 {
			continue
		}
		switch resp.QueryId {
		case authorQueryId:
			authorBytes = resp.Entries[0].Value
		case feeQueryId:
			feePoolBytes = resp.Entries[0].Value
		case counterQueryId:
			counterBytes = resp.Entries[0].Value
		}
	}
	// decode the records; absent keys decode into zero valued structs, which is exactly what a
	// first-ever post (empty counter) and a brand new fee pool should look like
	if err = Unmarshal(authorBytes, author); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	if err = Unmarshal(feePoolBytes, feePool); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	if err = Unmarshal(counterBytes, counter); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	// the author pays the fee, so they must be able to cover it. This is the check that makes the
	// guestbook spam resistant, and it is stateful, which is why it lives here and not in CheckTx.
	if author.Amount < fee {
		return &PluginDeliverResponse{Error: ErrInsufficientFunds()}
	}
	// guard the fee pool against overflow before crediting it
	if feePool.Amount > math.MaxUint64-fee {
		return &PluginDeliverResponse{Error: ErrInvalidAmount()}
	}
	// move the fee from the author to the fee pool, where validators later collect it
	author.Amount -= fee
	feePool.Amount += fee
	// ids start at 1, so an absent (zero valued) counter means 'the next post is post 1'. This
	// keeps id 0 free as an unambiguous 'no such post' sentinel for clients.
	if counter.NextId == 0 {
		counter.NextId = 1
	}
	// refuse to wrap the id space rather than overwriting post 1 after 2^64 posts
	if counter.NextId == math.MaxUint64 {
		return &PluginDeliverResponse{Error: ErrPostCounterOverflow()}
	}
	// build the immutable record and advance the counter
	post := &Post{
		Id:            counter.NextId,
		AuthorAddress: msg.AuthorAddress,
		Content:       msg.Content,
		Height:        height,
	}
	counter.NextId++
	// encode everything that changed
	postBytes, err := Marshal(post)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	counterBytes, err = Marshal(counter)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	authorBytes, err = Marshal(author)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	feePoolBytes, err = Marshal(feePool)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	// write the whole batch atomically. Unlike DeliverMessageSend we always write the author's
	// account back rather than deleting it when it drains to zero: an author whose balance hits
	// exactly zero still owns posts in the feed, and keeping the record costs one empty value
	// while keeping this handler simple and its state transition obvious.
	resp, err := c.plugin.StateWrite(c, &PluginStateWriteRequest{
		Sets: []*PluginSetOp{
			{Key: KeyForPost(post.Id), Value: postBytes},
			{Key: counterKey, Value: counterBytes},
			{Key: authorKey, Value: authorBytes},
			{Key: feePoolKey, Value: feePoolBytes},
		}})
	if err == nil {
		err = resp.Error
	}
	return &PluginDeliverResponse{Error: err}
}
