//==============================================================================
// Libra Ticket Center Demo
/* libra-ticket-center.js

sudo pm2 start|restart|stop /pathTo/libra-ticket-center.js

*/
//=============================================================================
// import modules
// 
//-----------------------------------------------------------------------------
'use strict'

    const EdDSA = require('elliptic').eddsa
    const ec = new EdDSA('ed25519')
    const { SHA3 } = require('sha3');
    const libracore =require('libra-core')
    const https = require('https')
    const WsServer = require('ws').Server
    const fs = require("fs")

//=============================================================================
// data
// 
//-----------------------------------------------------------------------------

    //------------------------------------------------------------
    // BOB
    const BOB_ADDRESS_HEX='4fb5de5cf96588273ceab41ee1a807ea4efb0c6f8c08f10c2efc617175cea390'
    const BOB_PRI_KEY_HEX='16253458330e54b08e3d492d200776d8af2d0367bbca4ca59df88985175a6069';
    // Create key pair from secret
    const BobPriKey = ec.keyFromSecret(BOB_PRI_KEY_HEX, 'hex');// hex string, array or Buffer
    // const nemonic=["uncle", "grow", "purchase", "fury", "upper", "chalk", "venture", "evidence", "enrich", "margin", "gentle", "range", "seven", "route", "clip", "vehicle", "ticket", "lawn", "stuff", "hungry", "clap", "muffin", "choice", "such"]
    // Import public key
    const BOB_PUB_KEY_HEX = '6e6579f1f368f9a4ac6d20a11a7741ed44d1409a923fa9b213e0160d90aa0ecc';
    const BobPubKey = ec.keyFromPublic(BOB_PUB_KEY_HEX, 'hex');
    //------------------------------------------------------------
    // ALICE
    let ALICE_ADDRESS_HEX='5ddea88879129cf59fd59fa82c3096c52e377e1bb258fe70672c016580ae9b89'
    //------------------------------------------------------------
    // LIBRA
    const CLIENT = new libracore.LibraClient({ network: libracore.LibraNetwork.Testnet });
    //unit of Libra
    const LIBRA_UNIT=1000000
    //The ticket price is 10 Libra
    const TICKET_AMOUNT=10*LIBRA_UNIT//10*1000000 is 10 Libra

    //------------------------------------------------------------
    // WebSocket config
    //
    const port = 8888 //from client port 443 by nginx proxy upstream websocket 
    const host='wss.libra-auth.com'
    const pemPath='/etc/myletsencrypt/live/'+host
    const options = {
        cert: fs.readFileSync(pemPath+'/fullchain.pem')
        ,key: fs.readFileSync(pemPath+'/privkey.pem')
    }
    const HB=JSON.stringify({type:'hb'})//heartbeat
 
    //test


//=============================================================================
// main 
// 
//------------------------------------------------------------------------------

    // lets start
    main()

    function main() {

        //------------------------------------------------------------
        // start WebSocket Server
        let wss=conn(port)
        console.log('start wss', host, port, new Date())
    }


//=============================================================================
// WebSocket Operations
// 
//-----------------------------------------------------------------------------

    //------------------------------------------------------------
    // conn WebSocket
    // @param port {number}
    // @return wss {object} WebSocket
    function conn(port){
        let app = https.createServer(options, function (req, res) {
            res.writeHead(200, {'Content-Type': 'text/plain'})
            res.end('libra auth!\n')
        }).listen(port)
        
        //WS server start
        let wss = new WsServer({server: app})
        //on connection
        wss.on('connection', function(socket, req) {

            const ip = req.headers['x-forwarded-for']||req.connection.remoteAddress
            socket.client={
                id      : uuidv4()
                ,ip      : ip
                ,time    : new Date().getTime()
                ,pubkey  : null
                ,isAlive : true
            }
            
            //info
            console.log(
                port
                , host 
                ,'conned to '
                , (new Date)
                , ip
            )
            
            socket.on('message', function(msg) {
                console.log('on message')
                onmsg(msg, socket)
            })
            socket.on('close', function() {
                console.log('closed: '
                    , socket.readyState
                    , (new Date)
                    , ip
                )
                delClient(socket, 'at onclose')
            })
        })
        return wss
    }
    //------------------------------------------------------------
    // onmsg
    // @param msg {string} received json stringified message
    function onmsg(msg, socket){

        //parse
        let received
        try {
            console.log(1, msg)
            received = JSON.parse(msg)
        } catch (e) {
            console.log('JSONparse err:', msg)
            return
        }

        //branch
        console.log('received', received)
        if(!received)return
        console.log('received.type', received.type)
        if(!received.type)return
        console.log(received.data)
        if(received.type === 'addr'){
            if(!received.data)return
            //address
            console.log(received.data)
            onReceivedAddress(received.data, socket)
        } else if(received.type === 'sig'){
            if(!received.data)return
            //signeture 
            onGetSigneture(received.data, socket)
        } else if(received.type==='hb'){
            // Heartbeat response
            wssSend(socket, 'hb')
        } else {
            return
        }
        
    }

    //------------------------------------------------------------
    // wssSend send to client
    // @param type {object} type e.g. 'hb'|'addr'|'sig'
    // @param data {any} The object to send
    function wssSend(socket, type, data){
        if(socket.readyState!==1){
            delClient(socket, 'at wssSend')
        } else {
            if(type==='hb'){
                socket.send(HB)
            } else {
                socket.send(
                    JSON.stringify({
                        type: type,
                        data: data
                    })
                )
            }
        }
    }
    //------------------------------------------------------------
    // delClient
    // @param socket {object} socket
    function delClient(socket, at) {
        console.log('--to be del--: '
            , at
            , socket.readyState
            , socket.client
        )
        //socket.client.isAlive=false
        socket.client=null
        socket.close()
        socket.terminate()
    }

//=============================================================================
// LIBRA operations
// 
//-----------------------------------------------------------------------------

    //------------------------------------------------------------
    // Event executed when an address is received from the client
    // @addrees {number} libra addrees
    // @return sequence{number} last sequence number
    async function onReceivedAddress(addrees, socket){

        //-------------------------------------------------
        // 5) mk sigB

        //get tx
        // In this demo, Alice generates a new address every time, 
        // so it is assumed that the sequence is 0. 
        // At the time of implementation, 
        // it is necessary to search for an appropriate tx.
        let seq=0
        const transaction = await CLIENT.getAccountTransaction(addrees, seq, false)
        const publicKeyHex=buffer2hex(transaction.signedTransaction.publicKey)
        const AlicePubKey = ec.keyFromPublic(publicKeyHex, 'hex')

        // set to Notes for each client
        socket.client.addrees=addrees
        socket.client.pubkey=publicKeyHex

        // mk Massage
        const salt = 'my sweet salt'
        const saltHash = (new SHA3(512)).update(salt).digest('hex')
        const random = saltHash + Math.random().toString()
        const msgHash = (new SHA3(512)).update(random).digest('hex')

        // 5. BOB: sigB = BobPriKey.sign(msg)
        const sigB= BobPriKey.sign(msgHash).toHex();

        //-------------------------------------------------
        // 6) BOB: Send sigB and msg to Alice by WebSocket. socket.send(sigB, msg)

        wssSend(socket, 'sig', [sigB, msgHash])

        
        return
        const sequence=getLastSequence(addrees, async function(val){
            let sequence=+val.sequenceNumber

            console.log('onReceivedAddress', addrees, sequence)



                /*
                .then((value) => {
                    //if(callback)callback( value)
                    console.log('value:',value)
                }, (reason) => {
                    console.log('error:',reason)
                })*/
        })
        
        return
        findLastTxBobAndAlic(sequence, ALICE_ADDRESS_HEX)
        let pubKey=getPubKey(addrees, sequence)
        //BOB_ADDRESS_HEX   
    }
    async function getTx2(client, addrees, sequence) {
        const transaction = await client.getAccountTransaction(addr, sequence, false)
        .then((value) => {
            console.log(value)
           // if(callback)callback( value)
        }, (reason) => {
            
        console.log(reason)
        })
        //console.log(transaction.signedTransaction.publicKey)
        //console.log(+transaction.signedTransaction.transaction.sequenceNumber)
        
        //console.log(JSON.stringify(transaction, null, 2))
      }

    //------------------------------------------------------------
    // get accountState object
    // @addrees {number} libra addrees
    // @return accountState{Objecr} accountState
    function getAccountStat(addrees){
        return CLIENT.getAccountState(addrees)
    }
    //------------------------------------------------------------
    // get balance 
    // @addrees {number} libra addrees
    // @return accountState{Objecr} accountState
    function getBalance(accountState){
        return CLIENT.getAccountState(addrees)
    }
    //------------------------------------------------------------
    // 4) 最新のシークエンス番号を取得する
    // @addrees {number} libra addrees
    // @return sequence{string} string of last sequence number
    function getLastSequence(addrees, callback){
        //const accountState = CLIENT.getAccountState(addrees)
            CLIENT
                .getAccountState(addrees)
                .then((value) => {
                    if(callback)callback( value)
                }, (reason) => {
                    console.log('error:',reason)
                })
        
        
    }
    //------------------------------------------------------------
    // 4) seach last transaction from bob and alice address
    // @sequence{number} sequence number
    // @clientAddr {number} client Address
    // @return {object} transaction
    function findLastTxBobAndAlic(sequence, clientAddr){
        let tx
        for(let i=sequence;i<=0;i--){
            tx=null; tx=getTx(alice, sequence, false)

            //chk alice bob balance これで特定してよいか
            console.log(getPubKey(transaction))
        }

        return tx
    }
    //------------------------------------------------------------
    // buffer to hex
    // @array{uint8array} array
    // @return {string} hex
    function buffer2hex(array) {
        return Array.prototype.map.call(
          new Uint8Array(array), x => ('00' + x.toString(16)
        ).slice(-2)).join('')
    }

//=============================================================================
// Util Functions
// 
//-----------------------------------------------------------------------------

    //------------------------------------------------------------
    // uuidv4
    //
    function uuidv4() {
        // Thanx for
        // https://gist.github.com/jcxplorer/823878
        // https://web.archive.org/web/20150201084235/http://blog.snowfinch.net/post/3254029029/uuid-v4-js

        let uuid = ''
        let random
        for (let i = 0; i < 32; i++) {
            random = Math.random() * 16 | 0
            if (i == 8 || i == 12 || i == 16 || i == 20) {
                uuid += '-'
            }
            uuid += (i == 12 ? 4 : (i == 16 ? (random & 3 | 8) : random)).toString(16)
        }
        return uuid
    }