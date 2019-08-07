var Botkit = require('botkit')
var Airtable = require('airtable')
var _ = require('lodash')
var express = require('express')
var moment = require('moment-timezone')
var randomstring = require("randomstring")

var app = express()

require('dotenv').config()

var base = new Airtable({
    apiKey: process.env.AIRTABLE_KEY
}).base(process.env.AIRTABLE_BASE)

var mongoStorage = require('botkit-storage-mongo')({
    mongoUri: process.env.MONGODB_URI
})

console.log("Hurrr..... Backbone is running. Attempting to wake up villager")

var controller = Botkit.slackbot({
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    clientSigningSecret: process.env.SLACK_CLIENT_SIGNING_SECRET,
    scopes: ['bot', 'chat:write:bot'],
    webhook_uri: '/api/messages',
    storage: mongoStorage
})

console.log("Hurrrrrrr... new hat! I'm up at door (port) " + process.env.PORT)

controller.setupWebserver(process.env.PORT, (err, webserver) => {
    controller.createWebhookEndpoints(controller.webserver)
    controller.createOauthEndpoints(controller.webserver)
});

// load market content from AirTable and send in message
function sendMarket(message) {

    var market = ""

    base('TMarket').select({
        maxRecords: 1000,
        view: "Grid view"
    }).eachPage(function page(records, fetchNextPage) {

        records.forEach(function (record) {

            if (record.get("Display")) {
                var current = {
                    id: record.get("Item ID"),
                    product: record.get("Product"),
                    price: record.get("Price") + "gp"
                }

                var line = "`!" + current.id + "` " + current.product + "—" + current.price

                if (!record.get("Available"))
                    market += ">~" + line + "~ _Sold Out_\n"
                else
                    market += ">" + line + "\n"
            }

        })

        // move on in pagination
        fetchNextPage()

    }, function done(err) {
        if (err) {
            console.error(err);
            return;
        }

        var greeting = "Welcome to the Market, ordinary customer!\nTake a look at our gourmet products, handcrafted by your local villagers (my friends, hehe)."
        var actionables = "You can purchase items by using the `/buy` command. For example: `/buy !MAGN`. Make sure you've got enough of that gp stuff!"

        bot.replyPublic(message, greeting + "\n\n" + market + "\n" + actionables)

        // Send message as "visible only to you"
        /*
            bot.sendEphemeral({
                channel: message.channel_id,
                user: message.user_id,
                text: greeting + "\n\n" + market + "\n" + actionables
            })
        */
    });

}

function purchase(message, item) {

    base('TMarket').select({
        maxRecords: 100,
        view: "Grid view"
    }).eachPage(function page(records, fetchNextPage) {

        records.forEach(function (record) {

            if (record.get("Item ID") == item) {

                if (record.get("Available")) {
                    base('TOrders').create({
                        "Product": [record.getId()],
                        "Timestamp": moment().tz("America/Los_Angeles").format(),
                        "Slack ID": message.user_id,
                        "Slack Name": message.user_name,
                        "Payment Key": randomstring.generate(8)
                    }, function (e, r) {
                        if (e) {
                            console.error(e);
                            return
                        }
                        console.log("Created order " + r.get("Purchase ID"))

                        var prompt = "*Order #" + r.get("Purchase ID") + " created* :white_check_mark:\n\n" +
                            "Please reply with the following command to complete the payment process. You can... " +
                            "also have your best friend pay for you by asking them to use this command.\n\nYour payment key " +
                            "is unique to your order! I will let you know when the payment is received. \n\nAlso, notice my hat! \n\n"
                        var command = "/give <@ULX6HE0DN> " + record.get("Price") + "gp for $" + r.get("Payment Key") + "$"

                        bot.replyPublic(message, prompt + "```\n" + command + "\n```")
                    })
                } else {
                    bot.replyPublic(message, "Oops. I'm out of \"" + record.get("Product") + "\" at the moment... Perhaps I could interest you with ~a bite of my new hat~ a sniff of *my new hat*? hehe")
                }

                return
            }
        });

        fetchNextPage();

    }, function done(err) {
        if (err) {
            console.error(err);
            return;
        }
    });

}

// lookup status of order
function lookup(message, order) {

    if (isNaN(order))
        console.log("Uhh... Param passed into lookup() is not an order #")

    console.log("User " + message.user_id + " requested a lookup for order #" + order)

    // verify if amount is correct
    base('TOrders').select({
        // Selecting the first 100 records in Grid view:
        maxRecords: 100,
        view: "Grid view"
    }).eachPage(function page(records, fetchNextPage) {

        records.forEach(function (record) {

            if (record.get("Purchase ID") == order) {
                // found order
                base('TOrders').find(record.getId(), function (err, record) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    if (record.get("Slack ID") !== message.user) {
                        bot.replyPublic(message, ":man-shrugging: I'm sorry... It looks like I can't give you that information.")
                        return
                    } else {
                        var status = record.get("Status")
                        if (status === undefined)
                            bot.replyPublic(message, ":alarm_clock:  Order #" + order + " is currently *pending*. Please check back later!")
                        else if (status == "Completed")
                            bot.replyPublic(message, ":star2: Order #" + order + " has been *completed*. If you have any questions, please email team@hackclub.com.")
                        else
                            bot.replyPublic(message, ":information_source: Order #" + order + " is currently *" + status + "*.")
                        return
                    }
                });

            }

        })

    });
}

function refund(message, order, amount, user, autoDecline, reason) {
    // refund
    console.log("Starting refund for order #" + order + "!")

    // 1. talk to banker 
    if (autoDecline)
        bot.replyInThread(message, "<@UH50T81A6> give <@" + user + "> " + amount + "gp for Declined payment refund for order #" + order)
    else {
        // directly DM banker
        bot.say({
            user: "@UH50T81A6",
            channel: "@UH50T81A6",
            text: "give <@" + user + "> " + amount + "gp for Cancelled order refund of order #" + order
        })
    }  

    var text = "";

    if (autoDecline) 
        text = ":rotating_light: *Your payment for order #" + order + " has been declined.* Please double check and try again."
    else   
        text = ":rotating_light: *Your order #" + order + " has been cancelled and refunded.* Reason: " + reason
    // 2. talk to user (I've refunded)
    bot.say({
        user: '@' + user,
        channel: '@' + user,
        text: text
    })
}

// handle slack command end
controller.on('slash_command', (bot, message) => {
    var {
        command,
        text,
        user_id,
        user_name
    } = message
    var user = user_id
    console.log(`Slash command received from ${user_id}: ${text}`)
    console.log(message)

    // list 
    if (command == '/market') {
        sendMarket(message)
    } else if (command == '/buy') {
        var text = message.text

        if (text.substring(0, 1) != "!")
            bot.replyPublic(message, "Hurrrrrr... Use `/buy !CODE`.")
        else {
            var item = text.split("!")[1]
            purchase(message, item)
        }
    } else if (command == '/order') {
        var order = +message.text
        if (order == NaN) {
            bot.replyPublic(message, "Hurrrrr... wut? Use `/order #`")
        } else {
            lookup(message, order)
        }
    }
})

// handles payment
controller.hears('.*', 'direct_message', (bot, message) => {

    if (message.user == "UH50T81A6") {
        // is banker's message
        var raw = message.text.split("|").map(item => item.trim());
        var user = raw[1].substring(2, raw[1].length - 1),
            amount = parseInt(raw[2]),
            key = raw[3].substring(6, raw[3].length - 2)

        // communication identifier
        if (raw[0] != "$$$")
            return

        // verify if amount is correct
        base('TOrders').select({
            // Selecting the first 3 records in Grid view:
            maxRecords: 100,
            view: "Grid view"
        }).eachPage(function page(records, fetchNextPage) {

            records.forEach(function (record) {

                if (record.get("Payment Key") == key) {

                    if (record.get("Product Price") == amount && !record.get("Paid")) {
                        // complete payment

                        base('TOrders').update(record.getId(), {
                            "Paid": true,
                            "Paid Timestamp": moment().tz("America/Los_Angeles").format()
                        }, function (err, record) {
                            if (err) {
                                console.error(err);
                                return;
                            }

                            console.log("Order " + record.get("Purchase ID") + " has been paid.");

                            var customer = record.get("Slack ID");
                            bot.say({
                                user: '@' + customer,
                                channel: '@' + customer,
                                text: "*:tada: Your order #" + record.get("Purchase ID") + " has been paid by <@" + user + ">!* A staff member will be in touch soon."
                            })
                        });

                    } else {
                        refund(message, record.get("Purchase ID"), amount, user, true)
                    }
                }
            });

            fetchNextPage();

        }, function done(err) {
            if (err) {
                console.error(err);
                return;
            }
        });
    } else {
        var raw = message.text.split(" ").map(item => item.trim());

        console.log("Raw DM: " + raw)

        var action = raw[0],
            order = parseInt(raw[1]),
            reason = message.text.split('"')[1],
            key = raw[raw.length-1]
        
        if (key == process.env.ADMIN_KEY) {

            // initiate refund process
            // (refund 10 "reason" ADMINKEYTOKEN)
            if (action == "refund") {

                // verify if amount is correct
                base('TOrders').select({
                    // Selecting the first 3 records in Grid view:
                    maxRecords: 100,
                    view: "Grid view"
                }).eachPage(function page(records, fetchNextPage) {

                    records.forEach(function (record) {

                        if (record.get("Purchase ID") == order) {

                            // initiate refund process
                            base('TOrders').update(record.getId(), {
                                "Paid": false,
                                "Paid Timestamp": moment().tz("America/Los_Angeles").format()
                            }, function (err, record) {
                                refund(message, record.get("Purchase ID"), record.get("Product Price"), record.get("Slack ID"), false, reason)
                            })

                        }
                    });

                    fetchNextPage();

                }, function done(err) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                });
            }

        }
        bot.replyInThread(message, 'new hat... who dis?')
    }

})

// other direct messages and mentions (unhandled)
controller.hears('.*', 'direct_mention', (bot, message) => {

    // Ignore if reply is in a thread. Hack to work around infinite bot loops.
    if (_.has(message.event, 'parent_user_id')) return

    bot.replyInThread(message, 'new hat... who dis?')

})

app.use(express.static('public'))