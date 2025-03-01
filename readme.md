# Denon Receiver Control for Stream Deck

A Stream Deck plugin that provides network control of Denon/Marantz receivers with HEOS support.

## Features

- **Volume Control**: Display and adjust volume levels, with mute/unmute functionality
  - Works with both standard Stream Deck buttons and Stream Deck+ dials
  - Shows real-time volume level on dials
  - Visual feedback for mute state

- **Power Control**: Turn your receiver on/off with visual power state feedback

- **Input Source Selection**: Quick access to switch between input sources
  - Supports standard Denon/Marantz input sources

- **Multi-Zone Support**: Control Main Zone and Zone 2 independently for actions that support zones

## Requirements

- Stream Deck Software 6.4 or later
- macOS 10.15 or later
- Windows 10 or later
- Denon or Marantz receiver with HEOS support
- Receiver must be on the same network as your computer

## Installation

### Download and install locally
1. Download the latest release from -> [here](https://github.com/mthiel/stream-deck-denon-receiver/releases/latest) <-
2. Double-click the downloaded file to install
3. Stream Deck software will automatically install the plugin

## Usage

1. Add any of the receiver control actions to your Stream Deck
2. When first configuring an action:
   - The plugin will automatically search for compatible receivers on your network
   - Select your receiver from the dropdown list
   - Choose the zone you want to control
   - Configure action-specific settings

### Available Actions

#### Volume Control
- Use as a button to toggle mute or set specific volume levels
- On Stream Deck+: 
  - Turn dial to adjust volume
  - Push/touch to toggle mute
  - Shows current volume level on dial display

#### Dynamic Volume Control
- Available as a button to cycle through each state
- Shows the current state of the feature from the receiver

#### Power Control
- Toggle power state
- Explicitly set power on or off
- Visual feedback shows current power state

#### Input Source Control
- Quick selection of input sources

## Development

This plugin is built using:
- Node.js 20
- Stream Deck SDK v2
- @elgato/streamdeck node module

To build from source:

```
npm install
npm run build
npm run pack
```

For development with auto-reload:

```
npm install
npm run watch
```

## Troubleshooting

If your receiver isn't detected:
1. Ensure your receiver has HEOS support and is enabled (You do not need to be logged into HEOS though)
3. Verify your receiver is on the same LAN segment as your computer
4. Check that no firewall is blocking network discovery
5. Try refreshing the receiver list in the action settings
