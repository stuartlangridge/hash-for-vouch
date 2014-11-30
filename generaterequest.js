var crypto = require("crypto"),
    qs = require("querystring"),
    request = require("request");

var counter = 0,
    t = Math.round(new Date().getTime() / 1000),
    url = "http://example.com";
while (true) {
    var sha256 = crypto.createHash('sha256');
    sha256.update(url + "-" + t + "-" + counter);
    dig = sha256.digest('hex');
    //console.log(counter, dig);
    if (dig.match(/^00000/)) {
        var fields = {source: url, nonce: counter, time: t};
        console.log("Requesting with parameters", qs.stringify(fields));
        request.post({url: 'http://hash-for-vouch.herokuapp.com/endpoint', form: fields}, function(err, httpResponse, body) {
            console.log("Response", body);
        });
        break;
    }
    counter += 1;
}