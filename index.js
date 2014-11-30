var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    crypto = require('crypto'),
    pg = require('pg'),
    exphbs  = require('express-handlebars');;

// Create database contents table on startup
pg.connect(process.env.DATABASE_URL, function(err, client, done) {
    client.query('create table if not exists vouches ' +
    '(id serial primary key, source varchar, ' +
    'created timestamp DEFAULT now() NOT NULL)', function(err, result) {
        if (err) {
            done(); throw new Error(err);
        } else {
            // Create function to delete rows after time N
            // thank you http://www.the-art-of-web.com/sql/trigger-delete-old/
            var fn = 'CREATE OR REPLACE FUNCTION delete_old_rows() RETURNS trigger ' +
            'LANGUAGE plpgsql AS $$ BEGIN ' +
            "DELETE FROM vouches WHERE created < NOW() - INTERVAL '3 minutes';" +
            'RETURN NEW; END; $$;';
            client.query(fn, function(err, result) {
                if (err) {
                    done(); throw new Error(err);
                } else {
                    // and trigger that function to be called whenever we add new rows
                    var dtr = 'DROP TRIGGER IF EXISTS old_rows_gc ON vouches;';
                    client.query(dtr, function(err, result) {
                        if (err) {
                            done(); throw new Error(err);
                        } else {
                            var tr = 'CREATE TRIGGER old_rows_gc AFTER INSERT ON vouches ' +
                            'EXECUTE PROCEDURE delete_old_rows();';
                            client.query(tr, function(err, result) {
                                if (err) {
                                    done(); throw new Error(err);
                                } else {
                                    console.log("Database set up OK", result);
                                    done(); 
                                }
                            });
                        }
                    });
                }
            });
        }
    });
});

app.set('port', (process.env.PORT || 3000));
app.use(express.static(__dirname + '/public'));

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

app.use(bodyParser.urlencoded({
  extended: true
}));

app.get('/', function (req, res) {
    res.render('home');
});

app.get('/details', function (req, res) {
    res.render('details');
});

app.get('/vouch/:id', function (req, res) {
    if (isNaN(parseInt(req.params.id, 10))) {
        return res.status(400).render("error", {error: "That isn't a valid vouch ID."});
    }
    pg.connect(process.env.DATABASE_URL, function(err, client, done) {
        if (err) {
            console.log("Error connecting to db for vouch", req.params.id, err);
            return res.status(500).render("error", {error: "There was a problem connecting to the database. Sorry."});
        }
        client.query('select source, created from vouches where id = $1::int', [req.params.id], function(err, result) {
            done(); // release client back to the pool
            if (err) {
                console.log("Error selecting for vouch", req.params.id, err);
                return res.status(500).render("error", {error: "There was a problem retrieving that vouch; sorry. Try again."});
            }
            if (result.rows.length < 1) {
                return res.status(404).render("error", {error: "That vouch doesn't seem to exist."});
            }
            res.render("vouch", {source: result.rows[0].source});
        });
    });
});

app.post('/endpoint', function(req, res) {
    if (!req.body || !req.body.source || !req.body.nonce || !req.body.time) {
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
    sha256.update(req.body.source + "-" + req.body.time + "-" + req.body.nonce);
    var dig = sha256.digest('hex');
    if (!dig.match(/^00000/)) {
        return res.status(400).json({error: "That's a bad hash, Harry"});
    }

    pg.connect(process.env.DATABASE_URL, function(err, client, done) {
        if (err) {
            return res.status(500).json({error: "Couldn't save these details to vouch for you; sorry. Try again."});
        }
        client.query('insert into vouches (source) values ($1::varchar) returning id', [req.body.source], function(err, result) {
            done(); // release client back to the pool
            
            if (err) {
                return res.status(500).json({error: "Couldn't save when trying to vouch for you; sorry. Try again."});
            } else {
                var vouchurl = req.originalUrl.replace(/endpoint$/, "vouch/" + result.rows[0].id);
                res.json({url: req.protocol + '://' + req.get('host') + vouchurl});
            }
        });
    });
    return;


    res.json({});
});
    
var server = app.listen(app.get('port'), function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});
