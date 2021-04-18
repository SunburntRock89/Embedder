import config from "./config"
import MessageHandler from "./MessageHandler"
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

client.on("ready", () => console.log(`Logged in as ${client.user?.tag}!`))
client.on("message", async(msg: Message) => handler.handleMessage(msg));
client.on("messageUpdate", async(oldMsg: Message | PartialMessage, newMsg: Message | PartialMessage) => handler.handleMessage(newMsg, oldMsg));

let token;

client.login(config.token);

// https://discord.com/api/oauth2/authorize?client_id=828678339950018630&permissions=2147871744&scope=bot