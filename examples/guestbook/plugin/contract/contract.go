package contract

import (
	"bytes"
	"encoding/binary"
	"log"
	"math"
	"math/rand"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/anypb"
)

/* This file contains the base contract implementation that overrides the basic 'transfer' functionality */

// PluginConfig: the configuration of the contract
var ContractConfig = &PluginConfig{
	Name:    "go_plugin_contract",
	Id:      1,
	Version: 1,
	// SupportedTransactions and TransactionTypeUrls are aligned BY INDEX: entry i of one names the
	// same transaction as entry i of the other. Canopy rejects the plugin schema at handshake if the
	// two lists differ in length, and a mismatched order would silently route a transaction to the
	// wrong message type, so always append to both in the same position.
	SupportedTransactions: []string{"send", "post_message"},
	TransactionTypeUrls: []string{
		"type.googleapis.com/types.MessageSend",
		"type.googleapis.com/types.MessagePost",
	},
	EventTypeUrls: nil,
	// Declare every store key prefix this plugin owns for its own records. Canopy shares its FSM
	// keyspace with the plugin and reserves the single-byte prefixes 1-15 (accounts, pools,
	// validators, committees, ...). It validates this list at handshake and PANICS before the
	// plugin processes any block if one of these collides with that range.
	CustomStatePrefixes: [][]byte{postPrefix, postCounterPrefix},
}

// init sets FileDescriptorProtos after ensuring .pb.go files are initialized
func init() {
	// Explicitly initialize the proto files first to ensure File_*_proto are set
	file_account_proto_init()
	file_event_proto_init()
	file_plugin_proto_init()
	file_tx_proto_init()

	var fds [][]byte
	// Include google/protobuf/any.proto first as it's a dependency of event.proto and tx.proto
	for _, file := range []protoreflect.FileDescriptor{
		anypb.File_google_protobuf_any_proto,
		File_account_proto, File_event_proto, File_plugin_proto, File_tx_proto,
	} {
		fd, _ := proto.Marshal(protodesc.ToFileDescriptorProto(file))
		fds = append(fds, fd)
	}
	ContractConfig.FileDescriptorProtos = fds
}

// Contract() defines the smart contract that implements the extended logic of the nested chain
type Contract struct {
	Config    Config
	FSMConfig *PluginFSMConfig // fsm configuration
	plugin    *Plugin          // plugin connection
	fsmId     uint64           // the id of the requesting fsm
	height    uint64           // the block height carried by the request this contract was built for
}

// Genesis() implements logic to import a json file to create the state at height 0 and export the state at any height
func (c *Contract) Genesis(_ *PluginGenesisRequest) *PluginGenesisResponse {
	return &PluginGenesisResponse{} // TODO map out original token holders
}

// BeginBlock() is code that is executed at the start of `applying` the block
//
// NOTE ON BLOCK HEIGHT: a natural instinct is to capture request.Height here and stash it on the
// Contract for DeliverTx to read. That does not hold in this plugin: the plugin's inbound loop
// builds a FRESH Contract for every message it receives from the FSM (see ListenForInbound in
// plugin.go) and dispatches each one on its own goroutine, so a height written here is not the
// height any later DeliverTx would observe. Both PluginBeginRequest and PluginDeliverRequest carry
// the height explicitly, so DeliverMessagePost reads it from its own request instead — the
// deterministic source, immune to how those goroutines interleave.
func (c *Contract) BeginBlock(request *PluginBeginRequest) *PluginBeginResponse {
	// record the height on this (per-message) contract instance so handlers reached from this
	// request, and the log line below, agree on which block is being applied
	c.height = request.Height
	log.Printf("BeginBlock at height %d", c.height)
	return &PluginBeginResponse{}
}

// CheckTx() is code that is executed to statelessly validate a transaction
func (c *Contract) CheckTx(request *PluginCheckRequest) *PluginCheckResponse {
	// validate fee
	resp, err := c.plugin.StateRead(c, &PluginStateReadRequest{
		Keys: []*PluginKeyRead{
			{QueryId: rand.Uint64(), Key: KeyForFeeParams()},
		}})
	if err == nil {
		err = resp.Error
	}
	// handle error
	if err != nil {
		return &PluginCheckResponse{Error: err}
	}
	// convert bytes into fee parameters
	minFees := new(FeeParams)
	if err = Unmarshal(resp.Results[0].Entries[0].Value, minFees); err != nil {
		return &PluginCheckResponse{Error: err}
	}
	// check for the minimum fee
	if request.Tx.Fee < minFees.SendFee {
		return &PluginCheckResponse{Error: ErrTxFeeBelowStateLimit()}
	}
	// get the message
	msg, err := FromAny(request.Tx.Msg)
	if err != nil {
		return &PluginCheckResponse{Error: err}
	}
	// handle the message
	switch x := msg.(type) {
	case *MessageSend:
		return c.CheckMessageSend(x)
	case *MessagePost:
		return c.CheckMessagePost(x)
	default:
		return &PluginCheckResponse{Error: ErrInvalidMessageCast()}
	}
}

// DeliverTx() is code that is executed to apply a transaction
func (c *Contract) DeliverTx(request *PluginDeliverRequest) *PluginDeliverResponse {
	// get the message
	msg, err := FromAny(request.Tx.Msg)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	// handle the message
	switch x := msg.(type) {
	case *MessageSend:
		return c.DeliverMessageSend(x, request.Tx.Fee, request.Tx.Memo)
	case *MessagePost:
		// request.Height is the height of the block currently being applied; it is stamped onto the
		// stored Post. See BeginBlock() below for why the height is read from the request rather
		// than cached on the Contract between calls.
		return c.DeliverMessagePost(x, request.Tx.Fee, request.Height)
	default:
		return &PluginDeliverResponse{Error: ErrInvalidMessageCast()}
	}
}

// EndBlock() is code that is executed at the end of 'applying' a block
func (c *Contract) EndBlock(_ *PluginEndRequest) *PluginEndResponse {
	return &PluginEndResponse{}
}

// CheckMessageSend() statelessly validates a 'send' message
func (c *Contract) CheckMessageSend(msg *MessageSend) *PluginCheckResponse {
	// check sender address
	if len(msg.FromAddress) != 20 {
		return &PluginCheckResponse{Error: ErrInvalidAddress()}
	}
	// check recipient address
	if len(msg.ToAddress) != 20 {
		return &PluginCheckResponse{Error: ErrInvalidAddress()}
	}
	// check amount
	if msg.Amount == 0 {
		return &PluginCheckResponse{Error: ErrInvalidAmount()}
	}
	// return the authorized signers
	return &PluginCheckResponse{Recipient: msg.ToAddress, AuthorizedSigners: [][]byte{msg.FromAddress}}
}

// DeliverMessageSend() handles a 'send' message
func (c *Contract) DeliverMessageSend(msg *MessageSend, fee uint64, memo string) *PluginDeliverResponse {
	log.Printf("DeliverMessageSend called: from=%x to=%x amount=%d fee=%d", msg.FromAddress, msg.ToAddress, msg.Amount, fee)
	var (
		fromKey, toKey, feePoolKey         []byte
		fromBytes, toBytes, feePoolBytes   []byte
		fromQueryId, toQueryId, feeQueryId = rand.Uint64(), rand.Uint64(), rand.Uint64()
		from, to, feePool                  = new(Account), new(Account), new(Pool)
	)
	// calculate the from key and to key
	fromKey, toKey, feePoolKey = KeyForAccount(msg.FromAddress), KeyForAccount(msg.ToAddress), KeyForFeePool(c.Config.ChainId)
	log.Printf("Keys: fromKey=%x toKey=%x feePoolKey=%x", fromKey, toKey, feePoolKey)
	// get the from and to account
	response, err := c.plugin.StateRead(c, &PluginStateReadRequest{
		Keys: []*PluginKeyRead{
			{QueryId: feeQueryId, Key: feePoolKey},
			{QueryId: fromQueryId, Key: fromKey},
			{QueryId: toQueryId, Key: toKey},
		}})
	// check for internal error
	if err != nil {
		log.Printf("StateRead error: %v", err)
		return &PluginDeliverResponse{Error: err}
	}
	// ensure no error fsm error
	if response.Error != nil {
		log.Printf("StateRead FSM error: %v", response.Error)
		return &PluginDeliverResponse{Error: response.Error}
	}
	log.Printf("StateRead returned %d results", len(response.Results))
	// get the from bytes and to bytes
	for _, resp := range response.Results {
		log.Printf("Result QueryId=%d Entries=%d", resp.QueryId, len(resp.Entries))
		if len(resp.Entries) == 0 {
			log.Printf("WARNING: No entries for QueryId=%d", resp.QueryId)
			continue
		}
		switch resp.QueryId {
		case fromQueryId:
			fromBytes = resp.Entries[0].Value
			log.Printf("fromBytes len=%d", len(fromBytes))
		case toQueryId:
			toBytes = resp.Entries[0].Value
			log.Printf("toBytes len=%d", len(toBytes))
		case feeQueryId:
			feePoolBytes = resp.Entries[0].Value
			log.Printf("feePoolBytes len=%d", len(feePoolBytes))
		}
	}
	// convert the bytes to account structures
	if err = Unmarshal(fromBytes, from); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	if err = Unmarshal(toBytes, to); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	if err = Unmarshal(feePoolBytes, feePool); err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	if msg.Amount > math.MaxUint64-fee {
		return &PluginDeliverResponse{Error: ErrInvalidAmount()}
	}
	amountToDeduct := msg.Amount + fee
	log.Printf("from.Amount=%d to.Amount=%d feePool.Amount=%d", from.Amount, to.Amount, feePool.Amount)
	// if the account amount is less than the amount to subtract; return insufficient funds
	if from.Amount < amountToDeduct {
		log.Printf("ERROR: Insufficient funds: from.Amount=%d amountToDeduct=%d", from.Amount, amountToDeduct)
		return &PluginDeliverResponse{Error: ErrInsufficientFunds()}
	}
	// for self-transfer, use same account data
	isSelfTransfer := bytes.Equal(fromKey, toKey)
	if isSelfTransfer {
		to = from
	}
	if feePool.Amount > math.MaxUint64-fee || (!isSelfTransfer && to.Amount > math.MaxUint64-msg.Amount) {
		return &PluginDeliverResponse{Error: ErrInvalidAmount()}
	}
	// subtract from sender
	from.Amount -= amountToDeduct
	// add the fee to the 'fee pool'
	feePool.Amount += fee
	// add to recipient
	to.Amount += msg.Amount
	log.Printf("AFTER: from.Amount=%d to.Amount=%d feePool.Amount=%d", from.Amount, to.Amount, feePool.Amount)
	// convert the accounts to bytes
	fromBytes, err = Marshal(from)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	toBytes, err = Marshal(to)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	feePoolBytes, err = Marshal(feePool)
	if err != nil {
		return &PluginDeliverResponse{Error: err}
	}
	// Retain drained accounts only when they carry nonce state or core will advance the nonce after RLP.V2 delivery.
	request := &PluginStateWriteRequest{Sets: []*PluginSetOp{
		{Key: feePoolKey, Value: feePoolBytes},
		{Key: toKey, Value: toBytes},
	}}
	if from.Amount == 0 && from.Nonce == 0 && memo != "RLP.V2" {
		request.Deletes = []*PluginDeleteOp{{Key: fromKey}}
	} else {
		request.Sets = append(request.Sets, &PluginSetOp{Key: fromKey, Value: fromBytes})
	}
	resp, err := c.plugin.StateWrite(c, request)
	if err != nil {
		log.Printf("StateWrite internal error: %v", err)
		return &PluginDeliverResponse{Error: err}
	}
	if resp.Error != nil {
		log.Printf("StateWrite FSM error: %v", resp.Error)
		return &PluginDeliverResponse{Error: resp.Error}
	}
	log.Printf("StateWrite SUCCESS!")
	return &PluginDeliverResponse{}
}

var (
	accountPrefix = []byte{1} // store key prefix for accounts
	poolPrefix    = []byte{2} // store key prefix for pools
	paramsPrefix  = []byte{7} // store key prefix for governance parameters
)

// KeyForAccount() returns the state database key for an account
func KeyForAccount(addr []byte) []byte {
	return JoinLenPrefix(accountPrefix, addr)
}

// KeyForFeeParams() returns the state database key for governance controlled 'fee parameters'
func KeyForFeeParams() []byte {
	return JoinLenPrefix(paramsPrefix, []byte("/f/"))
}

// KeyForFeeParams() returns the state database key for governance controlled 'fee parameters'
func KeyForFeePool(chainId uint64) []byte {
	return JoinLenPrefix(poolPrefix, formatUint64(chainId))
}

func formatUint64(u uint64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, u)
	return b
}
