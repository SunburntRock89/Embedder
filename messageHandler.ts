import config from "./config";
import { Client, Message, MessageReaction, PartialMessage, TextChannel, User } from "discord.js";
import eBayApi from "@hendt/ebay-api";
import getSymbolFromCurrency from "currency-symbol-map";
import { ContentLanguage } from "@hendt/ebay-api/lib/enums";
import { get } from "chainfetch";
import { parse } from "node-html-parser";
import urlRegex from "url-regex-safe";
import metascraper, { Scraper } from "metascraper";
import msDescription from "metascraper-description";
import msImage from "metascraper-image";
import msTitle from "metascraper-title";

export default class MessageHandler {
	constructor(client: Client) {
		this.client = client;
		this.ebay = new eBayApi({
			appId: config.eBay.clientID,
			certId: config.eBay.clientSecret,
			sandbox: false,
			siteId: eBayApi.SiteId.EBAY_GB,
			marketplaceId: eBayApi.MarketplaceId.EBAY_GB,
			scope: [
				"https://api.ebay.com/oauth/api_scope",
			],
			acceptLanguage: "en-GB",
			contentLanguage: ContentLanguage.en_GB,
		});

		this.ebay.oAuth2.getClientAccessToken();

		this.metascraper = metascraper([
			msDescription(),
			msImage(),
			msTitle(),
		]);
	}

	accessToken = "";
	ebay: eBayApi;
	tokenInterval: NodeJS.Timeout;
	client: Client;
	metascraper: Scraper
	static urlRegex: string = urlRegex({ strict: true })
	static ebayURLRegex = /(?:http|https)(?::\/\/)(?:www\.){0,1}ebay\.([a-z]{2,3}||[a-z]{2,3}\.[a-z]{2,3})(?:\/itm|\/i)\/(\d{12})/i;
	static amazonRegex = /((?:www\.)?amazon(?:\.[a-z]{2,3}){1,2}).*?(?:\/(?:dp|product))\/([A-Za-z0-9]{10})/i;
	static shpockURLRegex = /(?:http|https)(?::\/\/)(?:www\.shpock||shpock).com(?:\/\w{2}-\w{2}){0,1}\/i\/(.{16})/i;

	async handleMessage(msg: Message | PartialMessage, oldMsg?: Message | PartialMessage): Promise<Message> {
		if ((!msg.content!.toLowerCase().includes("ebay") && !msg.content!.toLowerCase().includes("amazon") && !msg.content!.toLowerCase().includes("shpock")) || msg.author.bot || (oldMsg && msg.content === oldMsg.content)) return;
		const urls: string[] = msg.content!.match(MessageHandler.urlRegex) || [];
		if (!urls.length) return;
		// eslint-disable-next-line no-extra-parens
		if (!msg.guild.me.hasPermission("EMBED_LINKS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("EMBED_LINKS"))) return msg.channel.send(":x: Error!\nI do not have permission to embed links in this channel. Please add this permission to my role and/or this channel to continue.");

		// eslint-disable-next-line no-extra-parens
		const canDelete: boolean = (msg.guild.me.hasPermission("MANAGE_MESSAGES") || (msg.guild && (msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("MANAGE_MESSAGES")));

		// Tf is this shit
		try {
			if (urls[0].match(MessageHandler.ebayURLRegex)) await this.ebayMessage(msg, urls, canDelete);
			else if (urls[0].match(MessageHandler.amazonRegex)) await this.amazonMessage(msg, urls, canDelete);
			else if (urls[0].match(MessageHandler.shpockURLRegex)) await this.shpockMessage(msg, urls, canDelete);
		} catch (e) {
			console.error(e);
			return msg.channel.send(urls[0], {
				embed: {
					color: 0xFF0000,
					title: ":x: Error!",
					description: "An unexpected error has occurred",
					footer: {
						text: "Sorry about that",
					},
				},
			});
		}
	}

	async ebayMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		const originalURL: string = urls[0];
		const split = originalURL.split(MessageHandler.ebayURLRegex);

		const itemID = split[2];

		const shortenedURL = `https://ebay.${split[1]}/i/${itemID}`;
		if (canDelete) msg.delete();
		console.log(`Shortened message from ${msg.author.tag} to ${shortenedURL}`);

		let item;
		try {
			item = await this.ebay.buy.browse.getItemByLegacyId({
				legacy_item_id: itemID,
			});
		} catch {
			try {
				item = (await this.ebay.buy.browse.getItemsByItemGroup(itemID).catch(null))?.items[0];
			} catch {
				msg.channel.send(canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), `${shortenedURL}: Not found`) : "Item not found.");
				return;
			}
		}

		let price;
		if (item.price.convertedFromCurrency) {
			price = `${getSymbolFromCurrency(item.price.convertedFromCurrency) || item.price.convertedFromCurrency}${item.price.convertedFromValue}`;
		} else {
			price = `${getSymbolFromCurrency(item.price.currency) || item.price.currency}${item.price.value}`;
		}

		const type = item.buyingOptions.includes("FIXED_PRICE") ? "BIN" : "Auction";

		let description = `${item.shortDescription ? `${item.shortDescription}\n\n` : ""}`;
		let city: boolean;
		if (item.itemLocation) {
			if (item.itemLocation.city) {
				city = true;
				description += `Located in ${item.itemLocation.city}${item.itemLocation.postalCode ? ", " : " "}`;
			}
			if (item.itemLocation.postalCode) {
				if (city) {
					description += `${item.itemLocation?.postalCode?.replace(/\*/gm, "").toUpperCase()}`;
				} else {
					city = true;
					description += `Located in ${item.itemLocation.postalCode.toUpperCase()} `;
				}
			}
		}
		if (city) {
			description += `- Condition: ${item.condition}`;
		} else {
			description += `Condition: ${item.condition}`;
		}

		const newmsg = await msg.channel.send(canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), shortenedURL) : "", { embed: {
			color: 0xde3036,
			author: {
				name: item.title,
				url: shortenedURL,
				icon_url: this.client.user.avatarURL(),
			},
			description,
			image: {
				url: item.image.imageUrl,
			},
			footer: {
				text: `${price} ${type} - Requested by ${msg.author.tag}`,
			},
		} });

		this.reactionDelete(newmsg, msg.author.id);
	}

	async amazonMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		// Imagine reducing code rewriting
		const originalURL: string = urls[0];

		const split: string[] = originalURL.match(MessageHandler.amazonRegex);
		if (!split || split.length < 2) return;
		const itemID = split[2];
		const shortenedURL = `https://${split[1]}/dp/${itemID}`;
		console.log(`Shortened message from ${msg.author.tag} to ${shortenedURL}`);

		// eslint-disable-next-line no-extra-parens
		msg.delete();

		let res;
		try {
			res = await get(shortenedURL)
				.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0")
				.toText();
		} catch (e) {
			msg.channel.send(canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), `${shortenedURL}: Not found`) : "Item not found.");
			return;
		}

		const rootHtmlNode = parse(res.body as string);

		const priceNode1 = rootHtmlNode.querySelector("#priceblock_dealprice");
		const priceNode2 = rootHtmlNode.querySelector("#priceblock_ourprice");

		const price = priceNode1?.text || priceNode2?.text;
		const title = rootHtmlNode.querySelector("span#productTitle.product-title-word-break")?.text.replace(/\n/gm, "") || null;
		const firstBullet = rootHtmlNode.querySelector("div#feature-bullets > ul > li:not(.aok-hidden) > span.a-list-item")?.text.replace(/\n/gm, "") || null;
		const imageURLNode = rootHtmlNode.querySelector("img#landingImage.a-dynamic-image");

		const newmsg = await msg.channel.send(canDelete ? msg.content.replace(originalURL, shortenedURL) : "", { embed: {
			color: 0xf79400,
			author: {
				name: title,
				url: shortenedURL,
				icon_url: this.client.user.avatarURL(),
			},
			description: `${firstBullet || ""}`,
			image: {
				url: imageURLNode.attrs.src,
			},
			footer: {
				text: `${price ? `${price} - ` : ""}Requested by ${msg.author.tag}`,
			},
		} });

		this.reactionDelete(newmsg, msg.author.id);
	}

	async shpockMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		const originalURL: string = urls[0];

		const split: string[] = originalURL.match(MessageHandler.shpockURLRegex);
		const itemID = split[1];

		if (canDelete) msg.delete();

		const scraperRes = await this.metascraper({
			url: originalURL,
			html: (await get(`https://www.shpock.com/en-gb/i/${itemID}`)).body,
		});

		scraperRes.title = scraperRes.title.replace(" for sale | Shpock", "");

		let title: string, price: string, location: string;

		if (scraperRes.title.match(/in/gi)?.length > 1) {
			let titleSplit = scraperRes.title.split(" in ");
			const correctOne = titleSplit[titleSplit.length - 1];

			titleSplit.length -= 1;
			title = titleSplit.join(" in ");

			titleSplit = correctOne.split(" for ");
			price = titleSplit[1];

			location = titleSplit[0];

			const locationSplit = location.split(/\w{3,4} /);
			if (locationSplit.length > 1) {
				location = `${locationSplit[1]}, ${location.match(/\w{3,4}/)[0]}`;
			}
		} else {
			let titleSplit = scraperRes.title.split(" in ");
			title = titleSplit[0];

			titleSplit = titleSplit[1].split(" for ");
			price = titleSplit[1];

			location = titleSplit[0];

			const locationSplit = location.split(/\w{3,4} /);
			if (locationSplit.length > 1) {
				location = `${locationSplit[1]}, ${location.match(/\w{3,4}/)[0]}`;
			}
		}

		const shortenedURL = `https://shpock.com/i/${itemID}`;
		console.log(`Shortened message from ${msg.author.tag} to ${shortenedURL}`);
		let description = `${scraperRes.description}...`;
		if (location) description += `\n\nLocated in ${location}`;

		const newmsg = await msg.channel.send(canDelete ? msg.content.replace(originalURL, shortenedURL) : "", { embed: {
			color: 0x3cce69,
			author: {
				name: title,
				url: shortenedURL,
				icon_url: this.client.user.avatarURL(),
			},
			description: description,
			image: {
				url: scraperRes.image,
			},
			footer: {
				text: `${price ? `${price} - ` : ""}Requested by ${msg.author.tag}`,
			},
		} });

		this.reactionDelete(newmsg, msg.author.id);
	}

	async reactionDelete(msg: Message, authorID: string): Promise<void> {
		// eslint-disable-next-line no-extra-parens
		if (!(msg.guild.me.hasPermission("MANAGE_MESSAGES") || (msg.guild && (msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("MANAGE_MESSAGES")))) return;
		// eslint-disable-next-line no-extra-parens
		if (!msg.guild.me.hasPermission("ADD_REACTIONS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("ADD_REACTIONS"))) return;

		const reaction = await msg.react("❌");
		msg.awaitReactions((newReaction: MessageReaction, user: User) => user.id === authorID && newReaction.emoji.toString() === "❌", { max: 1, time: 45 * 1000 })
			.then(collected => {
				if (collected.first().emoji.toString() == "❌" && collected.first().users.resolveID(msg.author.id)) {
					msg.delete();
				}
			}).catch(() => reaction.remove().catch(() => null));
	}
}
