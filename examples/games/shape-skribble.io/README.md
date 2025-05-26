# Skribbl.io AI Bot

An automated bot that plays Skribbl.io using AI vision and drawing capabilities.



https://github.com/user-attachments/assets/82f0d301-97ba-4461-85a3-979c644d0fa6



## Features

- **AI Vision**: Analyzes game screenshots to understand current state
- **Smart Guessing**: Uses computer vision to guess drawings
- **Automated Drawing**: Draws pictures when it's the bot's turn
- **Game State Detection**: Recognizes when to guess, draw, or wait

## Requirements

- Node.js
- Chrome/Chromium browser
- Shapes.inc API key (OpenAI-compatible)

## Installation

1. Clone/download the project
2. Install dependencies:
   ```bash
   npm install puppeteer openai
   ```
3. Add your Shapes.inc API key to the `SHAPES_API_KEY` variable in the code

## Usage

1. Update the Skribbl.io room URL in the code (currently set to a specific room)
2. Run the bot:
   ```bash
   node main.js
   ```
3. The bot will automatically join the game and start playing

## How It Works

1. Takes screenshots of the game screen
2. Uses AI to analyze the current game state
3. When guessing: Analyzes drawings and submits guesses
4. When drawing: Gets word options, generates drawing instructions, and draws on canvas
5. Waits during other players' turns

## Configuration

- Modify `SHAPES_BASE_URL` and model settings in the configuration section
- Adjust screenshot directory and timing delays as needed
- Update selectors if Skribbl.io's UI changes

## Notes

- Bot runs in non-headless mode for easier debugging
- Creates a `skribbl_screenshots` folder for game analysis
- Limited to 100 game loop iterations for safety
- May need selector updates if Skribbl.io changes their interface


