import config from "./config";
import { Client, Message, MessageReaction, PartialMessage, TextChannel, User, MessageButton, MessageActionRow, Collection } from "discord.js";
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
import RE2 from "re2";

interface eBayItem {
	title: string,
	url: string,
	image: string,
	additionalImages: string[],
	shortDescription: string,
	renderDescription: string,
	allImages: string[],
	price: string,
	itemLocation: string
	condition: string,
	type: string,
}

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

		setInterval(() => {
			this.ebayItemsCache.clear();
		}, 1 * 60 * 60 * 1000);
	}

	accessToken = "";
	ebay: eBayApi;
	tokenInterval: NodeJS.Timeout;
	client: Client;
	metascraper: Scraper
	static urlRegex = new RE2(urlRegex({ strict: true }));
	static ebayURLRegex = new RE2(/(http|https)(:\/\/)(www\.ebay||ebay)\.([a-z]{2,3}||[a-z]{2,3}\.[a-z]{2,3})(\/itm|\/i)/i);
	static amazonURLRegex = new RE2(/((?:www\.)?amazon(?:\.[a-z]{2,3}){1,2}).*?(?:\/(?:dp|product))\/([A-Za-z0-9]{10})/i);
	static shpockURLRegex = new RE2(/(?:http|https)(?::\/\/)(?:www\.shpock||shpock).com(?:\/\w{2}-\w{2}){0,1}\/i\/(.{16})/i);
	static ebayTLDRegex = new RE2(/(?:http|https)(?::\/\/)(?:www\.){0,1}ebay\.([a-z]{2,3}||[a-z]{2,3}\.[a-z]{2,3})\//i);

	ebayItemsCache: Collection<string, eBayItem> = new Collection();

	async handleMessage(msg: Message | PartialMessage, oldMsg?: Message | PartialMessage): Promise<void> {
		if ((!msg.content!.toLowerCase().includes("ebay") && !msg.content!.toLowerCase().includes("amazon") && !msg.content!.toLowerCase().includes("shpock")) || msg.author.bot || (oldMsg && msg.content === oldMsg.content)) return;
		const urls: string[] = MessageHandler.urlRegex.match(msg.content) || [];
		if (!urls.length) return;
		// eslint-disable-next-line no-extra-parens
		if (!msg.guild.me.permissions.has("EMBED_LINKS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("EMBED_LINKS"))) {
			msg.channel.send(":x: Error!\nI do not have permission to embed links in this channel. Please add this permission to my role and/or this channel to continue.");
			return;
		}

		// eslint-disable-next-line no-extra-parens
		const canDelete: boolean = (msg.guild.me.permissions.has("MANAGE_MESSAGES") || (msg.guild && (msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("MANAGE_MESSAGES")));

		// Tf is this shit
		try {
			if (MessageHandler.ebayURLRegex.match(urls[0])) await this.ebayMessage(msg, urls, canDelete);
			else if (MessageHandler.amazonURLRegex.match(urls[0])) await this.amazonMessage(msg, urls, canDelete);
			else if (MessageHandler.shpockURLRegex.match(urls[0])) await this.shpockMessage(msg, urls, canDelete);
		} catch (e) {
			console.error(e);
			msg.channel.send({
				content: urls[0],
				embeds: [{
					color: 0xFF0000,
					title: ":x: Error!",
					description: "An unexpected error has occurred",
					footer: {
						text: "Sorry about that",
					},
				}],
			});
		}
	}

	async ebayMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		const originalURL: string = urls[0];

		const split: string[] = urls[0].split("?");
		let shortenedURL: string = split ? split[0] : originalURL;
		if (shortenedURL.endsWith("/")) shortenedURL = shortenedURL.slice(0, -1);
		const itemID = shortenedURL.slice(-12);

		const tld = MessageHandler.ebayTLDRegex.match(originalURL)[1];

		shortenedURL = `https://ebay.${tld}/i/${itemID}`;
		if (canDelete) msg.delete();
		console.log(`Shortened message from ${msg.author.tag} to ${shortenedURL}`);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let item: any | eBayItem;
		let description: string, price: string, type: string, allImages: string[];
		item = this.ebayItemsCache.get(itemID);
		if (item) {
			description = item.renderDescription;
			price = item.price;
			type = item.type;
			allImages = item.allImages;
		} else {
			try {
				item = await this.ebay.buy.browse.getItemByLegacyId({
					legacy_item_id: itemID,
				});
			} catch {
				try {
					item = (await this.ebay.buy.browse.getItemsByItemGroup(itemID).catch(null))?.items[0];
					item.image = item.primaryItemGroup.itemGroupImage;
					item.additionalImages = item.primaryItemGroup.itemGroupAdditionalImages;
				} catch {
					msg.channel.send(canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), `${shortenedURL}: Not found`) : "Item not found.");
					return;
				}
			}

			price;
			if (item.price.convertedFromCurrency) {
				price = `${getSymbolFromCurrency(item.price.convertedFromCurrency) || item.price.convertedFromCurrency}${item.price.convertedFromValue}`;
			} else {
				price = `${getSymbolFromCurrency(item.price.currency) || item.price.currency}${item.price.value}`;
			}

			type = item.buyingOptions.includes("FIXED_PRICE") ? "BIN" : "Auction";

			description = `${item.shortDescription ? `${item.shortDescription}\n\n` : ""}`;
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

			allImages = [];
			allImages.push(item.image.imageUrl);
			allImages = allImages.concat(item.additionalImages.map(i => i.imageUrl));

			this.ebayItemsCache.set(itemID, {
				title: item.title,
				url: shortenedURL,
				image: item.image,
				additionalImages: item.additionalImages,
				allImages,
				shortDescription: item.shortDescription,
				renderDescription: description,
				price,
				itemLocation: item.itemLocation,
				condition: item.condition,
				type,
			});
		}

		const messageComponents: MessageButton[] = [];

		// eslint-disable-next-line no-extra-parens
		if (canDelete) {
			if (allImages.length > 1) {
				messageComponents.push(new MessageButton({
					emoji: "➡️",
					label: "Next",
					style: "SECONDARY",
					customId: "next",
				}));
				messageComponents.push(new MessageButton({
					emoji: "⬅️",
					label: "Previous",
					style: "SECONDARY",
					customId: "previous",
				}));
			}
			messageComponents.push(new MessageButton({
				emoji: "✖️",
				label: "Delete",
				style: "DANGER",
				customId: "delete",
			}));
		}

		await msg.channel.send({
			content: canDelete ? msg.content.toLowerCase().replace(originalURL.toLowerCase(), shortenedURL) : "",
			embeds: [{
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
			}],
			components: messageComponents.length > 0 ? [
				new MessageActionRow({
					components: messageComponents,
				}),
			] : null,
		});

		// this.reactionDelete(newmsg, msg.author.id);
	}

	async amazonMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		// Imagine reducing code rewriting
		const originalURL: string = urls[0];

		const split: string[] = MessageHandler.amazonURLRegex.match(originalURL);
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

		const newmsg = await msg.channel.send({
			content: canDelete ? msg.content.replace(originalURL, shortenedURL) : "",
			embeds: [{
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
			}] });

		this.reactionDelete(newmsg, msg.author.id);
	}

	async shpockMessage(msg: Message | PartialMessage, urls: string[], canDelete: boolean): Promise<void> {
		const originalURL: string = urls[0];

		const split: string[] = MessageHandler.shpockURLRegex.match(originalURL);
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

		const newmsg = await msg.channel.send({
			content: canDelete ? msg.content.replace(originalURL, shortenedURL) : "",
			embeds: [{
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
			}] });

		this.reactionDelete(newmsg, msg.author.id);
	}

	async reactionDelete(msg: Message, authorID: string): Promise<void> {
		// eslint-disable-next-line no-extra-parens
		if (!(msg.guild.me.permissions.has("MANAGE_MESSAGES") || (msg.guild && (msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("MANAGE_MESSAGES")))) return;
		// eslint-disable-next-line no-extra-parens
		if (!msg.guild.me.permissions.has("ADD_REACTIONS") || (!msg.guild && !(msg.channel as unknown as TextChannel).permissionsFor(this.client.user.id).has("ADD_REACTIONS"))) return;

		const reaction = await msg.react("❌");
		msg.awaitReactions({ max: 1, time: 45 * 1000, filter: (newReaction: MessageReaction, user: User) => user.id === authorID && newReaction.emoji.toString() === "❌" })
			.then(collected => {
				if (collected.first().emoji.toString() == "❌" && collected.first().users.resolveId(msg.author.id)) {
					msg.delete();
				}
			}).catch(() => reaction.remove().catch(() => null));
	}
}
