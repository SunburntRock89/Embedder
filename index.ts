import config from "./config";
import MessageHandler from "./MessageHandler";
import { Client, Intents, Message, PartialMessage } from "discord.js";
const FLAGS = Intents.FLAGS;

const client = new Client({ disableMentions: "everyone", ws: {
	intents: [
		FLAGS.GUILDS,
		FLAGS.GUILD_MESSAGES,
		FLAGS.GUILD_MESSAGE_REACTIONS,
	],
} });

const handler = new MessageHandler(client);

client.on("ready", () => console.log(`Logged in as ${client.user?.tag}!`));
client.on("guildCreate", guild => {
	guild.owner.send({
		embed: {
			color: 0xeb9f1c,
			title: ":wave: Hey there!",
			description: "Thanks for inviting my bot! I hope it serves you well.",
			fields: [{
				name: "Setup:",
				value: "Please ensure the bot has permission to embed links in any channels you intend to use it in.",
			}],
			footer: {
				text: "Have fun! -- SunburntRock89#7062",
			},
		},
	}).catch(null);
});
client.on("message", async(msg: Message) => handler.handleMessage(msg));
client.on("messageUpdate", async(oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage) => handler.handleMessage(newMsg, oldMsg));

client.login(config.token);

// https://discord.com/api/oauth2/authorize?client_id=828678339950018630&permissions=2147871744&scope=bot
