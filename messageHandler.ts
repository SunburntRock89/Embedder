import config from "./config";
import { Client, Message, PartialMessage, TextChannel } from "discord.js";
import eBayApi from "@hendt/ebay-api";
import getSymbolFromCurrency from "currency-symbol-map";
import { ContentLanguage } from "@hendt/ebay-api/lib/enums";
import { get } from "chainfetch";
import { parse } from "node-html-parser";
import urlRegex from "url-regex-safe";

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
	}

	accessToken = "";
	ebay: eBayApi;
	tokenInterval: NodeJS.Timeout;
	client: Client;
	static urlRegex: string = urlRegex({ strict: true })
	static ebayURLRegex = /(http|https)(:\/\/)(www\.ebay||ebay)\.([a-z]{2,3}||[a-z]{2,3}\.[a-z]{2,3})(\/itm)/i;

	async handleMessage(msg: Message | PartialMessage, oldMsg?: Message | PartialMessage): Promise<Message> {
		if ((!msg.content!.toLowerCase().includes("ebay") && !msg.content!.toLowerCase().includes("amazon")) || msg.author.bot || (oldMsg && msg.content === oldMsg.content)) return;
		const urls: string[] = msg.content!.match(MessageHandler.urlRegex) || [];
		if (!urls.length) return;
		// eslint-disable-next-line no-extra-parens
		if (!msg.guild.me.hasPermission("EMBED_LINKS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("EMBED_LINKS"))) return msg.channel.send(":x: Error!\nI do not have permission to embed links in this channel. Please add this permission to my role and/or this channel to continue.");

		// eslint-disable-next-line no-extra-parens
		const canDelete: boolean = (msg.guild.me.hasPermission("MANAGE_MESSAGES") || (msg.guild && (msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("MANAGE_MESSAGES")));

		// Tf is this shit
		try {
			if (urls[0].match(MessageHandler.ebayURLRegex)) await this.ebayMessage(msg, urls, canDelete);
			else if (new URL(urls[0]).host.match(/(www\.amazon||amazon)(\.[a-z]{2,3}){1,2}/i)) await this.amazonMessage(msg, urls, canDelete);
		} catch (e) {
			console.error(e);
			return msg.channel.send({
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
		const split: string[] = urls[0].split("?");
		let shortenedURL: string = split ? split[0] : originalURL;
		if (shortenedURL.endsWith("/")) shortenedURL = shortenedURL.slice(0, -1);
		const itemID = shortenedURL.slice(-12);

		shortenedURL = `${shortenedURL.match(MessageHandler.ebayURLRegex)![0]}/${itemID}`;
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

		// const description = `${item.itemLocation.city ? `Located in ${item.itemLocation?.city}, ${item.itemLocation?.postalCode?.replace(/\*/gm, "")} -` : ""} Condition: ${item.condition}`,
		let description = `${item.shortDescription ? `${item.shortDescription}\n\n` : ""}`;
		let city: boolean;
		if (item.itemLocation) {
			if (item.itemLocation.city) {
				city = true;
				description += `Located in ${item.itemLocation.city}`;
			}
			if (item.itemLocation.postalCode) {
				if (city) {
					description += `, ${item.itemLocation?.postalCode?.replace(/\*/gm, "").toUpperCase()}`;
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

		msg.channel.send(canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), shortenedURL) : "", { embed: {
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
	}

	async amazonMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		// Imagine reducing code rewriting
		const originalURL: string = urls[0];

		const split: string[] = originalURL.match(/((?:www\.)?amazon(?:\.[a-z]{2,3}){1,2}).*?(\/(?:dp|product)\/[A-Za-z0-9]{10}).*/);
		if (!split || split.length < 3) return;
		const itemID = split[2].slice(-10);
		const shortenedURL = `https://${split[1]}/dp/${itemID}`;

		// eslint-disable-next-line no-extra-parens
		msg.delete();

		let res;
		try {
			res = await get(originalURL)
				.set("User-Agent", "sunburntrock89/embedBot")
				.toText();
		} catch {
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

		msg.channel.send(canDelete ? msg.content.replace(originalURL, shortenedURL) : "", { embed: {
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
	}
}
