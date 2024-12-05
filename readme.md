# Denon Receiver Network Control for Stream Deck

A Stream Deck plugin that provides network control of Denon/Marantz receivers with HEOS support.

## Features

- **Volume Control**: Display and adjust volume levels, with mute/unmute functionality
  - Works with both standard Stream Deck buttons and Stream Deck+ dials
  - Shows real-time volume level on dials
  - Visual feedback for mute state
  
- **Power Control**: Turn your receiver on/off with visual power state feedback

- **Input Source Selection**: Quick access to switch between input sources
  - Supports all standard Denon/Marantz input sources
  - ~~Zone 2 can mirror Main Zone source~~ (Coming soon)

- **Multi-Zone Support**: Control Main Zone and Zone 2 independently

## Requirements

- Stream Deck Software 6.4 or later
- macOS 10.15 or later
- Windows 10 or later
- Denon or Marantz receiver with HEOS support
- Receiver must be on the same network as your computer

## Installation

### Install from the Elgato Marketplace (Coming soon)
*TBD: Currently only installable by building from source.*

<!--
1. Download the plugin from the Stream Deck Store
2. Double-click the downloaded file to install
3. Stream Deck software will automatically install the plugin
-->

### Download and install locally (Probably coming soon)
*TBD: Currently only installable by building from source.*


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

#### Power Control
- Toggle power state
- Explicitly set power on or off
- Visual feedback shows current power state

#### Input Source Control
- Quick selection of input sources
- ~~Option to mirror Main Zone source in Zone 2~~ (Coming soon)

## Development

This plugin is built using:
- Node.js 20
- Stream Deck SDK v2
- @elgato/streamdeck SDK
- *Process currently only tested on MacOS 15*

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
1. Ensure your receiver has HEOS support and is enabled
2. Verify your receiver is on the same network as your computer
3. Check that no firewall is blocking network discovery
4. Try refreshing the receiver list in the action settings
