/// <reference path="../../src/types/sdpi-components.d.ts" />

const { streamDeckClient } = SDPIComponents;

/**
 * Inform the plugin that the user has selected a receiver. (Or unset the receiver)
 * @param {HTMLSelectElement} receiverSelect - The receiver select element.
 */
async function handleUserChoseReceiver(receiverSelect) {
    receiverSelect.disabled = true;
    await streamDeckClient.send('sendToPlugin', { event: 'userChoseReceiver' });
    receiverSelect.disabled = false;
}

/**
 * Update the volume level item based on the selected volume action.
 * @param {HTMLSelectElement} volumeActionSelect - The volume action select element.
 */
function handleVolumeUIChange(volumeActionSelect) {
    /** @type {HTMLTextAreaElement | null} SDPI TextField Element */
    const volumeLevelItem = document.querySelector('sdpi-textfield[setting="volumeLevel"]');
    if (!(volumeActionSelect && volumeLevelItem)) return;

    const shouldDisableVolumeLevel = volumeActionSelect.value !== "set";
    volumeLevelItem.disabled = shouldDisableVolumeLevel;
}

/**
 * Update the layout for the action based on the action ID.
 */
async function updateLayoutForAction() {
    const connectionInfo = await streamDeckClient.getConnectionInfo();
    const controller = connectionInfo.actionInfo.payload.controller;
    const actionId = connectionInfo.actionInfo.action.split(".").slice(-1)[0];

    // Reveal the appropriate action section based on the action ID.
    switch (actionId) {
        case "power":
            document.querySelector('.action-section.power')?.classList.remove('hidden');
            break;
        case "volume":
            if (controller === "Keypad") {
                document.querySelector('.action-section.volume')?.classList.remove('hidden');
                /** @type {HTMLSelectElement | null} */
                const volumeActionSelect = document.querySelector('sdpi-select[setting="volumeAction"]');
                if (volumeActionSelect) {
                    handleVolumeUIChange(volumeActionSelect);
                }
            }
            break;
        case "source":
            if (controller === "Keypad") {
                document.querySelector('.action-section.source')?.classList.remove('hidden');
            }
            break;
    }
}

// Perform the necessary setup once the DOM is loaded.
document.addEventListener('DOMContentLoaded', () => {
    updateLayoutForAction();
});