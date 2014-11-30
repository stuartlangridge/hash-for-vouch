var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    crypto = require('crypto');

app.set('port', (process.env.PORT || 3000));
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.urlencoded({
  extended: true
}));

app.get('/', function (req, res) {
  res.send('This is hash for vouch. POST to /endpoint. Docs go here.');
});

app.post('/endpoint', function(req, res) {
    if (!req.body || !req.body.target || !req.body.nonce || !req.body.time) {
        return res.status(400).json({error: "Incomplete request"});
    }
    var time = parseInt(req.body.time, 10);
    if (isNaN(time)) {
        return res.status(400).json({error: "Bad time"});
    }
    if (((new Date().getTime() / 1000) - time) > 60 * 10) {
        return res.status(400).json({error: "Request too old"});
    }
    var sha256 = crypto.createHash('sha256');
    sha256.update(req.body.target + "-" + req.body.time + "-" + req.body.nonce);
    if (!sha256.digest('hex').match(/^000000/)) {
        return res.status(400).json({error: "That's a bad hash, Harry"});
    }

    // OK now save it in a database, and return the URL to the page which displays it.
    res.json({});
});
    
var server = app.listen(app.get('port'), function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});
