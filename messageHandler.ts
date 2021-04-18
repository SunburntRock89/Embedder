import config from "./config"
import { Client, Message, PartialMessage, TextChannel } from "discord.js";
import eBayApi from '@hendt/ebay-api';
import getSymbolFromCurrency from 'currency-symbol-map'
import { ContentLanguage } from "@hendt/ebay-api/lib/enums";
import { get } from "chainfetch";
import * as Chainfetch from "chainfetch" ;
import { parse } from "node-html-parser";

export default class MessageHandler {
	constructor(client) {
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

		this.ebay.oAuth2.getClientAccessToken()
	}

	accessToken: string = "";
	ebay: eBayApi;
	tokenInterval: NodeJS.Timeout;
	client: Client;
	static urlRegex: string = require("url-regex-safe")({ strict: true })
	static ebayURLRegex: RegExp = /(http|https)(:\/\/)(www\.ebay||ebay)\.([a-z]{2,3}||[a-z]{2,3}\.[a-z]{2,3})(\/itm)/i;

	async handleMessage(msg: Message | PartialMessage, oldMsg?: Message | PartialMessage) {
		
		if ((!msg.content!.toLowerCase().includes("ebay") && !msg.content!.toLowerCase().includes("amazon")) || msg.author.bot || (oldMsg && msg.content === oldMsg.content)) return;
		const urls: string[] = msg.content!.match(MessageHandler.urlRegex) || [];
		if (!urls.length) return;
		if (!msg.guild.me.hasPermission("EMBED_LINKS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("EMBED_LINKS"))) return msg.channel.send(":x: Error!\nI do not have permission to embed links in this channel. Please add this permission to my role and/or this channel to continue.")
		
		// Tf is this shit
		try { 
			if (urls[0].match(MessageHandler.ebayURLRegex)) await this.ebayMessage(msg, urls);	
			else if (new URL(urls[0]).host.match(/(www\.amazon||amazon)(\.[a-z]{2,3}){1,2}/i)) await this.amazonMessage(msg, urls);
		} catch {
			return msg.channel.send({
				embed: {
					color: 0xFF0000,
					title: ":x: Error!",
					description: "An unexpected error has occurred",
					footer: {
						text: "Sorry about that",
					}
				}
			})
		}
	}

	async ebayMessage(msg: Message | PartialMessage, urls) {
		const originalURL: string = urls[0];
		const split: string[] = urls[0].split("?");
		let shortenedURL: string = split ? split[0] : originalURL;
		if (shortenedURL.endsWith("/")) shortenedURL = shortenedURL.slice(0, -1)
		let itemID = shortenedURL.slice(-12)
		
		shortenedURL = `${shortenedURL.match(MessageHandler.ebayURLRegex)![0]}/${itemID}`;
		await msg.delete();
		console.log(`Shortened message from ${msg.author.tag} to ${shortenedURL}`)

		let item = await this.ebay.buy.browse.getItemByLegacyId({
			legacy_item_id: itemID,
		});

		let price;
		if (item.price.convertedFromCurrency) {
			price = `${getSymbolFromCurrency(item.price.convertedFromCurrency) || item.price.convertedFromCurrency}${item.price.convertedFromValue}`
		} else {
			price = `${getSymbolFromCurrency(item.price.currency) || item.price.currency}${item.price.value}`
		}

		let type = item.buyingOptions.includes("FIXED_PRICE") ? "BIN" : "Auction";
	
		msg.channel.send(msg.content.toLowerCase().replace(originalURL.toLowerCase(), shortenedURL), { embed: {
			color: 0xde3036,
			author: {
				name: item.title,
				url: shortenedURL,
				icon_url: this.client.user.avatarURL(),
			},
			description: `${item.shortDescription}\n\nLocated in ${item.itemLocation.city}, ${item.itemLocation.postalCode.replace(/\*/gm, "")} - Condition: ${item.condition}`,
			image: {
				url: item.image.imageUrl,
			},
			footer: {
				text: `${price} ${type} - Requested by ${msg.author.tag}`,
			}
		}})
	}

	async amazonMessage(msg: Message | PartialMessage, urls: string[]) {
		// Imagine reducing code rewriting
		const originalURL: string = urls[0];
		
		const split: string[] = originalURL.match(/((?:www\.)?amazon(?:\.[a-z]{2,3}){1,2}).*?(\/(?:dp|product)\/[A-Za-z0-9]{10}).*/)
		const itemID = split[2].slice(-10);
		const shortenedURL = `https://${split[1]}/dp/${itemID}`

		msg.delete();

		const res = await get(originalURL)
			.set("User-Agent", "sunburntrock89/embedBot")
			.toText();

		const rootHtmlNode = parse(res.body as string);

		const priceNode1 = rootHtmlNode.querySelector("#priceblock_dealprice")
		const priceNode2 = rootHtmlNode.querySelector("#priceblock_ourprice")
		
		const price = priceNode1?.text || priceNode2?.text;
		const title = rootHtmlNode.querySelector("span#productTitle.product-title-word-break")?.text.replace(/\n/gm, "") || null;
		const firstBullet = rootHtmlNode.querySelector("div#feature-bullets > ul > li:not(.aok-hidden) > span.a-list-item")?.text.replace(/\n/gm, "") || null;
		const imageURLNode = rootHtmlNode.querySelector("img#landingImage.a-dynamic-image")
		
		msg.channel.send(msg.content.replace(originalURL, shortenedURL), { embed: {
			color: 0xf79400,
			author: {
				name: title,
				url: shortenedURL,
				icon_url: this.client.user.avatarURL(),
			},
			description: `${firstBullet}`,
			image: {
				url: imageURLNode.attrs.src,
			},
			footer: {
				text: `${price ? `${price} - ` : ""}Requested by ${msg.author.tag}`,
			}
		}})
	}
}