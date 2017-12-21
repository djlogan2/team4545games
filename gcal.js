const fs = require('fs');
const ZonedDateTime = require('js-joda').ZonedDateTime;
const FORMATTER = require('js-joda').DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXXXX");

function Calendar() {
    this.google = require('googleapis');
    this.calendarId = 'primary';
}

Calendar.prototype.authenticate = function () {
    const self = this;

    function getClientSecret() {
        return new Promise(function (resolve, reject) {
            fs.readFile('client_secret.json', function (err, data) {
                if (err) {
                    throw new Error(err);
                    process.exit(0);
                }
                resolve(JSON.parse(Buffer.from(data).toString()));
            });
        });
    };

    function askUserToGetToken() {
        const authUrl = self.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar']
        });
        console.log('Please go to this URL, and then run me again with the token as a parmeter:');
        console.log(authUrl);
        process.exit(0);
    }

    function resolveAccessToken() {
        return new Promise(function (resolve, reject) {
            // Step 2: Try to load a previously saved access token
            fs.readFile('access_token.json', function (err, data) {
                if (err) {
                    if (process.argv.length === 3) {
                        self.oauth2Client.getToken(process.argv[2], function (err, token) {
                            if (err) {
                                throw new Error(err);
                                process.exit(0);
                            } else {
                                self.oauth2Client.credentials = token;
                                fs.writeFile('access_token.json', JSON.stringify(token), function (err) {
                                    if (err) {
                                        throw new Error(err);
                                        process.exit(0);
                                    }
                                    else resolve();
                                });
                            }
                        });
                    } else {
                        askUserToGetToken();
                    }
                } else {
                    self.oauth2Client.credentials = JSON.parse(data);
                    resolve();
                }
            });
        });
    }

    return getClientSecret()
        .then(function (secret) {
            self.oauth2Client = new self.google.auth.OAuth2(secret.installed.client_id, secret.installed.client_secret, secret.installed.redirect_uris[0]);
            self.google.options({auth: self.oauth2Client});
            return resolveAccessToken();
        });
};

Calendar.prototype.setCalendar = function(find_str)
{
    const self = this;
    return new Promise(function(resolve, reject){
        if(find_str === 'primary') { resolve('primary'); return; }
        const calendar = self.google.calendar('v3');
        calendar.calendarList.list({}, function(err, response){
            if(err) {
                console.log(new Error('The API returned an error: ' + err));
                reject(new Error(err));
                return;
            }
            for(let x = 0 ; x < response.items.length ; x++) {
                if(find_str === response.items[x].summary) {
                    self.calendarId = response.items[x].id;
                    resolve(response.items[x].id);
                    return;
                }
            }
            reject(new Error('No calendar found with a summary of ' + find_str));
        });
    });
};

Calendar.prototype.delete = function(event) {
    const self = this;
    return new Promise(function(resolve,reject){
        const calendar = self.google.calendar('v3');
        calendar.events.delete({
            calendarId: self.calendarId,
            eventId: event.id
        }, function(err){
            if(err) reject(err); else resolve();
        });
    });
};

Calendar.prototype.list = function () {
    const self = this;
    return new Promise(function(resolve, reject){
        const calendar = self.google.calendar('v3');
        calendar.events.list({
            calendarId: self.calendarId,
            timeMin: (new Date()).toISOString(),
            singleEvents: true,
            orderBy: 'startTime'
        }, function (err, response) {
            if (err) {
                console.log('The API returned an error: ' + err);
                reject(new Error(err));
                return;
            }
            resolve(response.items);
        });
    });
};

Calendar.prototype.getSummary = function (game) {
    const W = (game.player.white === game.player.us ? '*' : '');
    const B = (game.player.black === game.player.us ? '*' : '');
    return 'T4545: ' + W + game.player.white + '-' + B + game.player.black + '(' + game.team.us + ')';
};

Calendar.prototype.insert = function (game) {
    const self = this;
    const event = {
        calendarId: self.calendarId,
        summary: self.getSummary(game),
        // This is the 'notes' field  'description':  '[description] T4545: ' + white + '-' + black + '(' + team + ')',
        start: {
            dateTime: game.when.format(FORMATTER),
            //'timeZone': 'America/New_York',
        },
        end: {
            dateTime: (game.when.plusHours(3)).format(FORMATTER),
            //'timeZone': 'America/New_York',
        }
    };
    return new Promise(function(resolve, reject){
        const calendar = self.google.calendar('v3');
        calendar.events.insert({calendarId: self.calendarId, resource: event}, function(err, event){
            if(err) {
                console.log('The API returned an error: ' + err);
                reject(new Error(err));
                return;
            }
            resolve(event);
        });
    });
};

module.exports = Calendar;