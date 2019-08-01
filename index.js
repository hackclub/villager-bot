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

        if (text.substring(0,1) != "!") 
            bot.replyPublic(message, "Wrong syntax good sir... Use `/buy !CODE`.")
        else {
            var item = text.split("!")[1]
            purchase(message, item)
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
                                text: "*:tada: Your order #" + record.get("Purchase ID") + " has been paid!* A staff member will be in touch soon."
                            })
                        });

                    } else {
                        // refund
                        console.log("Starting refund!")

                        // 1. talk to banker 
                        bot.replyInThread(message, "<@UH50T81A6> give <@" + user + "> " + amount + "gp for Declined Payment Refund.")

                        // 2. talk to user (I've refunded)
                        bot.say({
                            user: '@' + user,
                            channel: '@' + user,
                            text: ":rotating_light: *Your payment for order #" + record.get("Purchase ID") + " has been declined.* Please double check and try again."
                        })
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