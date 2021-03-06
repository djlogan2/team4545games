'use strict';
const browser = new (require('zombie'))();
const google = require('googleapis');
const googleAuth = require('google-auth-library');
const fs = require('fs');
const GCalendar = require('./gcal');
const Joda = require('js-joda').use(require('js-joda-timezone'));
const _ = require('underscore');
const now = new Date();
const znow = Joda.ZonedDateTime.now(Joda.ZoneId.of('America/New_York'));
const FORMATTER = require('js-joda').DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXXXX");
let settings = {username: '', teams: []};

console.log('now=' + now.toString());
console.log('znow=' + znow.toString());

browser.waitDuration = 30000;

fs.readFile('settings.json', function (err, data) {
    if (!err)
        settings = JSON.parse(data);
});

function getGames() {
    var records = [];
    return new Promise(function (resolve, reject) {
        browser.visit('http://team4545league.org/tournament/games.html')
            .catch(function (err) {
                console.log(err);
                process.exit(0);
            })
            .then(function () {
                const nodes = browser.querySelectorAll('tr');
                for (let x = 2; x < nodes.length; x++) {
                    // Sat, Dec 16, 07:00
                    // 'Sat, Dec 16, 07:00'.split(/[ ,:]/)
                    // [ 'Sat', '', 'Dec', '16', '', '07', '00' ]
                    const dt = nodes[x].cells[2].textContent.split(/[ ,:]/);
                    const month = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(dt[2]) / 3 + 1;
                    const day = dt[3]; // - 1;
                    const hour = dt[5];
                    const min = dt[6];
                    const year = now.getFullYear() + (now.getMonth() > month ? 1 : 0);
                    const when = Joda.ZonedDateTime.of(year, month, day, hour, min, 0, 0, Joda.ZoneId.of('America/New_York'));
                    const record = {
                        division: nodes[x].cells[0].textContent,
                        round: nodes[x].cells[1].textContent,
                        when: when,
                        board: nodes[x].cells[8].textContent,
                        team: {
                            white: nodes[x].cells[3].textContent,
                            black: nodes[x].cells[7].textContent,
                            get us() {
                                if (!settings || !settings.teams || !settings.teams.length) return this.white;
                                return settings.teams.indexOf(this.black) !== -1 ? this.black : this.white;
                            },
                            get them() {
                                if (!settings || !settings.teams || !settings.teams.length) return this.black;
                                return settings.teams.indexOf(this.white) === -1 ? this.white : this.black;
                            }
                        },
                        player: {
                            white: nodes[x].cells[4].textContent,
                            black: nodes[x].cells[6].textContent,
                            get us() {
                                if (settings || !settings.teams || !settings.teams.length) return this.white;
                                return settings.teams.indexOf(this._team.black) !== -1 ? this.black : this.white;
                            },
                            get them() {
                                if (settings || !settings.teams || !settings.teams.length) return this.black;
                                return settings.teams.indexOf(this._team.white) === -1 ? this.white : this.black;
                            },
                        },
                        get isteamgame() {
                            if (!settings || !settings.teams || !settings.teams.length) return true; // If we have no teams, ALL games are team games
                            return settings.teams.indexOf(this.team.white) !== -1 || settings.teams.indexOf(this.team.black) !== -1;
                        },
                        get isourgame() {
                            if (!settings || !settings.username) return false; // If we have no username, NO game is our game
                            return (settings.username === this.player.white || settings.username === this.player.black);
                        }
                    };

                    record.player._team = record.team;
                    //console.log('Checking to see if we need to process the game: ' + gmail.getSummary(record));
                    if (!record.when.plusHours(3).isBefore(znow) && !record.isourgame && record.isteamgame) {
                        console.log('Processing game ' + gmail.getSummary(record) + ' ' + record.when.toString());
                        records.push(record);
                    } else {
                        const reasons = [!record.when.minusHours(3).isBefore(znow), !record.isourgame, record.isteamgame];
                        console.log('NOT processing game ' + gmail.getSummary(record) + ' ' + record.when.toString() + ' ' + reasons.join(',').toString());
                    }
                }
                resolve(records);
            })
            .catch(e => reject(e));
    });
}

const gmail = new GCalendar();
var events = null;
var leftover_games = [];

function dteq(date1, date2) {
    if (typeof date1 === 'string') date1 = Joda.ZonedDateTime.parse(date1);
    if (typeof date2 === 'string') date2 = Joda.ZonedDateTime.parse(date2);
    return date1.format(FORMATTER) === date2.format(FORMATTER);
}

/*
function otherteam(record) {
    if(!settings || !settings.teams || !settings.teams.length || _.findIndex(settings.teams, record.white_team) != -1) return record.black_team;
    else return record.white_team;
}
*/
gmail.authenticate()
    .then(() => gmail.setCalendar('team4545'))
    .then(() => gmail.list())
    .then(function (items) {
        events = items;
        return getGames();
    })
    .then(function (games) {
        games.forEach(function (game) {
            const summary = gmail.getSummary(game);
            console.log('Looking for event ' + summary + ' ' + game.when);
            const event = _.find(events, function (e) {
                console.log(e.summary + ' === ' + summary + ' , ' + e.start.dateTime + ' ' + game.when + ' ' + dteq(e.start.dateTime, game.when));
                return e.summary === summary && dteq(e.start.dateTime, game.when);
            });
            if (event) {
                console.log('found event ' + summary);
                const i = _.findIndex(events, function (e) {
                    return e.summary === event.summary && dteq(e.start.dateTime, game.when);
                });
                console.log('removing event[' + i + '] from the events array');
                events.splice(i, 1);
            } else {
                console.log('did not find event ' + summary);
                leftover_games.push(game);
            }
        });
        let promises = [];
        leftover_games.forEach(function (game) {
            console.log('Adding event: ' + game.team.them + ' ' + game.player.white + ' ' + game.player.black + ' ' + game.when);
            promises.push(gmail.insert(game));
        });
        events.forEach(function (event) {
            console.log('Deleting event: ' + event.summary + ' ' + event.start.dateTime);
            promises.push(gmail.delete(event));
        });
        return Promise.all(promises);
    }).then(function () {
    console.log('done');
    process.exit(0);
});
