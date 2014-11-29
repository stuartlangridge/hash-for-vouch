var crypto = require("crypto"),
    qs = require("querystring");

var counter = 0,
    t = Math.round(new Date().getTime() / 1000),
    url = "http://example.com";
while (true) {
    var sha256 = crypto.createHash('sha256');
    sha256.update(url + "-" + t + "-" + counter);
    dig = sha256.digest('hex');
    //console.log(counter, dig);
    if (dig.match(/^000000/)) {
        console.log(qs.stringify({target: url, nonce: counter, time: t}));
        break;
    }
    counter += 1;
}