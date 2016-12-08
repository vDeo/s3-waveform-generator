var express = require('express')
  , app = express.createServer()
  , SNSClient = require('aws-snsclient');
 
var auth = {
    verify: false;
}

var client = SNSClient(auth, function(err, message) {
    console.log(message);
});
 
app.post('/receive', client);
 
app.listen(8080);