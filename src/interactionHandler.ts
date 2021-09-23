import { Interaction, MessageComponentInteraction, Client, Message } from "discord.js";
import mh from "./messageHandler";

export default class InteractionHandler {
	client: Client;
	MessageHandler: mh;
	constructor(client: Client, MessageHandler: mh) {
		this.client = client;
		this.MessageHandler = MessageHandler;
	}

	async handleInteraction(_intr: Interaction): Promise<void> {
		switch (_intr.type) {
			case "MESSAGE_COMPONENT": {
				const interaction = _intr as MessageComponentInteraction;
				switch (interaction.customId) {
					case "next": {
						this.next(interaction);
						break;
					}
					case "previous": {
						this.previous(interaction);
						break;
					}
					case "delete": {
						this.delete(interaction);
						break;
					}
				}
				break;
			}
		}
	}

	async next(interaction: MessageComponentInteraction): Promise<void> {
		const split = interaction.message.embeds[0].footer.text.split(" - ");
		const userTag = split[split.length - 1].replace("Requested by ", "");

		if (interaction.user.tag !== userTag) {
			interaction.reply({ content: "You didn't post this!", ephemeral: true });
			return;
		}

		const itemID = interaction.message.content.slice(-12);
		const item = this.MessageHandler.ebayItemsCache.get(itemID);
		if (!item) {
			interaction.reply({ content: "This message was posted too long ago to interact with.", ephemeral: true });
			return;
		}

		const msg = interaction.message as Message;
		const currentIndex = item.allImages.indexOf(msg.embeds[0].image.url);
		const nextIndex = currentIndex + 1;

		// If the next image is the last image, disable the next button
		if (nextIndex === item.allImages.length - 1) this.updateButton("next", msg, true);
		// If we're on the first image, enable the back button as we're moving to second
		if (currentIndex == 0) this.updateButton("previous", msg, false);

		msg.edit({
			content: msg.content,
			embeds: [{
				color: 0xde3036,
				author: {
					name: item.title,
					url: msg.content,
					icon_url: this.client.user.avatarURL(),
				},
				description: item.renderDescription,
				image: {
					url: item.allImages[nextIndex],
				},
				footer: {
					text: `${item.price} ${item.type} - Requested by ${userTag}`,
				},
			}],
			components: msg.components,
		});

		interaction.deferUpdate();
	}

	async previous(interaction: MessageComponentInteraction): Promise<void> {
		const split = interaction.message.embeds[0].footer.text.split(" - ");
		const userTag = split[split.length - 1].replace("Requested by ", "");

		if (interaction.user.tag !== userTag) {
			interaction.reply({ content: "You didn't post this!", ephemeral: true });
			return;
		}

		const itemID = interaction.message.content.slice(-12);
		const item = this.MessageHandler.ebayItemsCache.get(itemID);
		if (!item) {
			interaction.reply({ content: "This message was posted too long ago to interact with.", ephemeral: true });
			return;
		}

		const msg = await interaction.channel.messages.fetch(interaction.message.id);
		const currentIndex = item.allImages.indexOf(msg.embeds[0].image.url);
		const nextIndex = currentIndex - 1;

		// If we're going to the first image, disable previous button
		if (nextIndex === 0) {
			this.updateButton("previous", msg, true);
		}
		// Otherwise if we're currently on the last image, reenable the forward button
		if (currentIndex == item.allImages.length - 1) {
			this.updateButton("next", msg, false);
		}

		msg.edit({
			content: msg.content,
			embeds: [{
				color: 0xde3036,
				author: {
					name: item.title,
					url: msg.content,
					icon_url: this.client.user.avatarURL(),
				},
				description: item.renderDescription,
				image: {
					url: item.allImages[nextIndex],
				},
				footer: {
					text: `${item.price} ${item.type} - Requested by ${userTag}`,
				},
			}],
			components: msg.components,
		});

		interaction.deferUpdate();
	}

	async delete(interaction: MessageComponentInteraction): Promise<void> {
		const split = interaction.message.embeds[0].footer.text.split(" - ");
		const userTag = split[split.length - 1].replace("Requested by ", "");
		if (interaction.user.tag !== userTag) {
			interaction.reply({ content: "You didn't post this!", ephemeral: true });
		} else {
			await (await interaction.channel.messages.fetch(interaction.message.id)).delete();
			interaction.deferUpdate();
		}
	}

	updateButton(id: string, msg: Message, disabled: boolean): void {
		const buttonIndex = msg.components[0].components.indexOf(msg.components[0].components.find(c => c.customId === id));
		const button = msg.components[0].components[buttonIndex];
		button.disabled = disabled;
		msg.components[0].spliceComponents(buttonIndex, 1, button);
	}
}
