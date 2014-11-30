var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    crypto = require('crypto'),
    pg = require('pg'),
    exphbs  = require('express-handlebars'),
    async = require('async');

// Create database contents table on startup
pg.connect(process.env.DATABASE_URL, function(err, client, returnClientToPool) {
    var sqls = [
        'create table if not exists vouches ' +
            '(id serial primary key, source varchar, ' +
            'created timestamp DEFAULT now() NOT NULL)',
        'create table if not exists highest_vouch_number ' +
            '(highest_vouch_number int)',
        'DO $$ BEGIN BEGIN ALTER TABLE vouches ADD COLUMN views int default 0; ' +
        "EXCEPTION WHEN duplicate_column THEN RAISE NOTICE 'Views column already present'; " +
        'END; END; $$',
        'CREATE OR REPLACE FUNCTION delete_old_rows() RETURNS trigger ' +
            'LANGUAGE plpgsql AS $$ BEGIN ' +
            "DELETE FROM vouches WHERE created < NOW() - INTERVAL '3 minutes';" +
            'RETURN NEW; END; $$;',
        'DROP TRIGGER IF EXISTS old_rows_gc ON vouches;',
        'CREATE TRIGGER old_rows_gc AFTER INSERT ON vouches ' +
            'EXECUTE PROCEDURE delete_old_rows();'
    ];
    async.eachSeries(sqls, function(sql, cb) {
        client.query(sql, function(err, result) {
            returnClientToPool();
            cb(err);
        });
    }, function(err) {
        if (err) {
            throw new Error(err);
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
        client.query('select source, created, views from vouches where id = $1::int', [req.params.id], function(err, result) {
            done(); // release client back to the pool
            if (err) {
                console.log("Error selecting for vouch", req.params.id, err);
                return res.status(500).render("error", {error: "There was a problem retrieving that vouch; sorry. Try again."});
            }
            if (result.rows.length < 1) {
                client.query('select highest_vouch_number from highest_vouch_number', function(err, result) {
                    done(); // release client back to the pool
                    if (err) {
                        console.log("Error selecting for disappeared vouch", req.params.id, err);
                        return res.status(404).render("oldvouch");
                    }
                    if (result.rows.length === 0 || result.rows[0].highest_vouch_number < req.params.id) {
                        return res.status(404).render("error", {error: "That vouch doesn't seem to exist."});
                    } else {
                        return res.status(404).render("oldvouch");
                    }
                });
                return;
            }
            res.render("vouch", {source: result.rows[0].source});
            if (result.rows[0].views > 20) {
                client.query("delete from vouches where id = $1::int", [req.params.id], function(err, result) {
                    done(); // release client back to the pool
                    if (err) { console.log("Got error deleting exceeded views vouch", req.params.id); }
                });
            } else if (result.rows[0].views === null) {
                client.query("update vouches set views = 1 where id = $1::int", [req.params.id], function(err, result) {
                    done(); // release client back to the pool
                    if (err) { console.log("Got error updating views count to 1 on vouch", req.params.id); }
                });
            } else {
                client.query("update vouches set views = views + 1 where id = $1::int", [req.params.id], function(err, result) {
                    done(); // release client back to the pool
                    if (err) { console.log("Got error updating views count on vouch", req.params.id); }
                });
            }
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
                // technically this is racy, but it doesn't matter; we only use highest_vouch_number
                // to indicate whether a 404ed vouch might have existed in the past, so if it's slightly
                // wrong, no major harm is done.
                client.query('insert into highest_vouch_number (highest_vouch_number) values ($1::int)', [result.rows[0].id], function(err, result) {
                });
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
