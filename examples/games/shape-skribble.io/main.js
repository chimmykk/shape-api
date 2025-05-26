const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { OpenAI } = require("openai"); // Assuming you have 'openai' package installed

// --- Configuration ---
// IMPORTANT: Replace with your actual API key for Shapes.inc (OpenAI-compatible API)
// Ensure your API key is kept secure and not publicly exposed.
const SHAPES_API_KEY = ""; // <<< REPLACE THIS
const SHAPES_BASE_URL = "https://api.shapes.inc/v1";

const shapes_client = new OpenAI({
    apiKey: SHAPES_API_KEY,
    baseURL: SHAPES_BASE_URL,
});

const screenshotDir = path.resolve(__dirname, "skribbl_screenshots");
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

// --- Utility Functions ---

async function takeScreenshot(page, step, description = "") {
    const screenshotPath = path.resolve(screenshotDir, `step-${step}-${description}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Screenshot taken: ${screenshotPath}`);
    return screenshotPath;
}

async function analyzeImage(imagePath, promptText) {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/png"; // Assuming all screenshots are PNG
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    try {
        const response = await shapes_client.chat.completions.create({
            model: "shapesinc/tenshi", // Or your preferred model
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptText },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                },
            ],
            temperature: 0.7, // Adjust creativity
            max_tokens: 300, // Limit response length
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error(`❌ Error analyzing image with Shapes API: ${error.message}`);
        return "UNKNOWN"; // Return a safe default on error
    }
}

// --- Game State Detection ---

async function detectGameState(imagePath) {
    const promptText = `Analyze this Skribbl.io game screen and tell me the current state.
    Pay close attention to whether the chat input field (where you type your guess) is visible and interactive.

    1. Is someone currently drawing? (Do you see a drawing in progress or drawing tools active?)
    2. Is it time for me to guess? (Is there a drawing visible that I should guess, AND is the guess input field visible?)
    3. Is it my turn to draw? (Do I see drawing tools/palette available for me to use, AND the word options to pick from?)
    4. Is the game waiting/between rounds? (e.g., scoreboard, 'Game starting soon' messages)
    5. Can you see any word hints or patterns (like "_ _ r d" or letter counts)?

    Respond with ONLY one of these states:
    - GUESSING_READY (if a drawing is visible AND the guess input is clearly visible and ready to type in)
    - DRAWING_TURN (if it's my turn to draw and I see word options or drawing tools)
    - WAITING (if it's between rounds, showing scoreboard, or other waiting screens)
    - DRAWING_IN_PROGRESS (if someone else is drawing but the guess input is NOT clearly ready)
    - UNKNOWN (if the state is unclear or none of the above)

    Include any word hints you see if the state is GUESSING_READY or DRAWING_IN_PROGRESS.`;

    const analysis = await analyzeImage(imagePath, promptText);
    return analysis.trim();
}

// --- Guessing Logic ---

async function guessFromImage(imagePath) {
    const promptText = `Look at this Skribbl.io drawing and make your best guess.

    Instructions:
    - Analyze the drawing carefully
    - Look for any word hints/patterns visible (like "c_o_____" or letter counts)
    - Consider common Skribbl.io words (animals, objects, actions, food, etc.)
    - Make a reasonable guess based on what you see
    - Respond with ONLY the word guess, no explanations or punctuation
    - If you see multiple possible answers, pick the most likely one`;

    const guess = await analyzeImage(imagePath, promptText);
    return guess.trim().toLowerCase().replace(/[^a-zA-Z\s]/g, '');
}

async function submitGuess(page, guess) {
    console.log(`💭 Attempting to submit guess: "${guess}"`);

    // The most robust selector for the guess input field within the chat form
    const guessInputSelector = '.chat-form input[placeholder*="Type your guess here"], ' +
                               '.chat-form input[data-translate="placeholder"], ' +
                               '.chat-form input[maxlength="100"]';

    try {
        console.log(`Waiting for guess input field: ${guessInputSelector}`);
        // Puppeteer's page.type implicitly waits for the element to be visible and enabled.
        await page.type(guessInputSelector, guess, { delay: 50 }); // Simulate human typing
        console.log("Typed guess, now pressing Enter...");
        await page.keyboard.press('Enter');
        console.log("✅ Successfully submitted guess via page.type.");
        return true;

    } catch (error) {
        console.log(`❌ Error submitting guess: ${error.message}`);
        // Take a screenshot to debug the state when the input wasn't found/interactable
        await takeScreenshot(page, 'DEBUG_SUBMIT_GUESS_FAIL', 'input_not_found');
        return false;
    }
}

// --- Drawing Logic ---

async function getWordToDrawFromScreen(imagePath) {
    const promptText = `Look at this Skribbl.io screen where it's my turn to draw.

    I need to identify the word I should draw. Look for:
    - A word displayed at the top or center of the screen
    - Text that says what I need to draw
    - Multiple word options I can choose from
    - Any UI elements showing the drawing word

    If you see word options to choose from, pick the easiest one to draw (e.g., shortest, simplest).
    If you see the word clearly, respond with just that word.
    If unclear, respond with "WORD_NOT_FOUND".`;

    const response = await analyzeImage(imagePath, promptText);
    return response.trim();
}

async function selectWordOption(page, word) {
    console.log(`🎯 Attempting to select word: "${word}"`);

    try {
        const selected = await page.evaluate((targetWord) => {
            const wordElements = Array.from(document.querySelectorAll('div, span, button'))
                .filter(el => {
                    const text = (el.textContent || el.innerText || '').trim().toLowerCase();
                    return text === targetWord.toLowerCase() &&
                           el.offsetWidth > 0 &&
                           el.offsetHeight > 0;
                });

            if (wordElements.length > 0) {
                wordElements[0].click();
                return true;
            }
            return false;
        }, word);

        if (selected) {
            console.log(`✅ Successfully selected word: "${word}"`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Short delay after clicking
            return true;
        }

        console.log(`❌ Could not find word option: "${word}"`);
        return false;

    } catch (error) {
        console.log(`❌ Error selecting word: ${error.message}`);
        return false;
    }
}

async function getDrawingInstructions(word) {
    const promptText = `I need to draw "${word}" in Skribbl.io using simple mouse movements on a canvas.
    Assume the canvas is cleared before I draw.

    Provide step-by-step drawing instructions using basic shapes and relative coordinates:
    - Use centerX, centerY as the reference point (center of canvas)
    - Specify relative positions like "centerX + 50" or "centerY - 30"
    - Use basic shapes: circles, rectangles, lines, triangles
    - Keep it simple but recognizable for a quick drawing game
    - Give specific coordinate instructions for each point.

    Format example:
    "1. Draw circle at centerX, centerY-20, radius 25
    2. Draw rectangle from centerX-40,centerY+10 to centerX+40,centerY+50
    3. Draw line from centerX-20,centerY+30 to centerX+20,centerY+30"

    Word to draw: ${word}`;

    try {
        const response = await shapes_client.chat.completions.create({
            model: "shapesinc/tenshi",
            messages: [{ role: "user", content: promptText }],
            temperature: 0.8, // Allow some creativity for drawing
            max_tokens: 500,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error(`❌ Error getting drawing instructions: ${error.message}`);
        return ""; // Return empty string on error
    }
}

async function drawBasedOnInstructions(page, instructions, word) {
    console.log(`🎨 Drawing "${word}" with AI instructions:`);
    console.log(instructions);

    try {
        // Find the drawing canvas element
        const canvas = await page.$('canvas') || await page.$('#canvasGame') || await page.$('.drawing-canvas');
        if (!canvas) {
            console.log("❌ Drawing canvas not found.");
            return false;
        }

        const canvasBox = await canvas.boundingBox();
        if (!canvasBox) {
            console.log("❌ Could not get canvas position.");
            return false;
        }

        const centerX = canvasBox.x + canvasBox.width / 2;
        const centerY = canvasBox.y + canvasBox.height / 2;

        console.log(`🎯 Canvas center: ${centerX}, ${centerY}, size: ${canvasBox.width}x${canvasBox.height}`);

        // Parse instructions and draw
        const steps = instructions.split(/\d+\./).filter(step => step.trim().length > 0);

        // Click a color (e.g., black) and the largest brush size before drawing
        // You'll need to inspect Skribbl.io's color palette and brush size selectors
        try {
             // Example: Click black color (assuming a common selector for color buttons)
            await page.click('div[data-color="#000000"]', {timeout: 1000}); // Adjust selector
            // Example: Click largest brush size
            await page.click('#size6', {timeout: 1000}); // Adjust selector for size button
            console.log("🖌️ Selected black color and largest brush size.");
            await new Promise(resolve => setTimeout(resolve, 200)); // Small pause
        } catch (colorBrushError) {
            console.log(`⚠️ Could not select color/brush: ${colorBrushError.message}. Proceeding with default.`);
        }


        for (let i = 0; i < steps.length; i++) {
            const step = steps[i].trim().toLowerCase();
            console.log(`🖌️ Step ${i + 1}: ${step}`);

            try {
                if (step.includes('circle')) {
                    await executeCircleInstruction(page, step, centerX, centerY);
                } else if (step.includes('rectangle') || step.includes('box')) {
                    await executeRectangleInstruction(page, step, centerX, centerY);
                } else if (step.includes('line')) {
                    await executeLineInstruction(page, step, centerX, centerY);
                } else if (step.includes('triangle')) {
                    await executeTriangleInstruction(page, step, centerX, centerY);
                } else {
                    console.log(`Skipping unknown drawing instruction: "${step}"`);
                }

                await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between strokes

            } catch (error) {
                console.log(`⚠️ Error in drawing step "${step}": ${error.message}`);
            }
        }

        console.log("✅ Finished drawing");
        return true;

    } catch (error) {
        console.log(`❌ Error in drawing: ${error.message}`);
        return false;
    }
}

// --- Drawing Primitive Implementations (from previous discussion) ---

async function executeCircleInstruction(page, instruction, centerX, centerY) {
    const radiusMatch = instruction.match(/radius\s+(\d+)/);
    const radius = radiusMatch ? parseInt(radiusMatch[1]) : 30;

    let x = centerX;
    let y = centerY;

    if (instruction.includes('centerx+')) {
        const match = instruction.match(/centerx\+(\d+)/);
        if (match) x += parseInt(match[1]);
    }
    if (instruction.includes('centerx-')) {
        const match = instruction.match(/centerx-(\d+)/);
        if (match) x -= parseInt(match[1]);
    }
    if (instruction.includes('centery+')) {
        const match = instruction.match(/centery\+(\d+)/);
        if (match) y += parseInt(match[1]);
    }
    if (instruction.includes('centery-')) {
        const match = instruction.match(/centery-(\d+)/);
        if (match) y -= parseInt(match[1]);
    }

    await drawCircle(page, x, y, radius);
}

async function executeRectangleInstruction(page, instruction, centerX, centerY) {
    let x = centerX - 40;
    let y = centerY - 30;
    let width = 80;
    let height = 60;

    const fromMatch = instruction.match(/from\s+centerx([+-]\d+),centery([+-]\d+)/);
    const toMatch = instruction.match(/to\s+centerx([+-]\d+),centery([+-]\d+)/);

    if (fromMatch && toMatch) {
        x = centerX + parseInt(fromMatch[1]);
        y = centerY + parseInt(fromMatch[2]);
        const toX = centerX + parseInt(toMatch[1]);
        const toY = centerY + parseInt(toMatch[2]);
        width = toX - x;
        height = toY - y;
    }

    await drawRectangle(page, x, y, width, height);
}

async function executeLineInstruction(page, instruction, centerX, centerY) {
    const fromMatch = instruction.match(/from\s+centerx([+-]\d+),centery([+-]\d+)/);
    const toMatch = instruction.match(/to\s+centerx([+-]\d+),centery([+-]\d+)/);

    let x1 = centerX, y1 = centerY, x2 = centerX, y2 = centerY;

    if (fromMatch) {
        x1 = centerX + parseInt(fromMatch[1]);
        y1 = centerY + parseInt(fromMatch[2]);
    }
    if (toMatch) {
        x2 = centerX + parseInt(toMatch[1]);
        y2 = centerY + parseInt(toMatch[2]);
    }

    await drawLine(page, x1, y1, x2, y2);
}

async function executeTriangleInstruction(page, instruction, centerX, centerY) {
    const sizeMatch = instruction.match(/size\s+(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 60;

    await drawTriangle(page, centerX, centerY, size);
}

async function drawLine(page, x1, y1, x2, y2) {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2);
    await page.mouse.up();
}

async function drawRectangle(page, x, y, width, height) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + width, y);
    await page.mouse.move(x + width, y + height);
    await page.mouse.move(x, y + height);
    await page.mouse.move(x, y); // Close the rectangle
    await page.mouse.up();
}

async function drawCircle(page, centerX, centerY, radius) {
    const steps = 24; // Number of segments for the circle
    const startX = centerX + radius;
    const startY = centerY;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    for (let i = 1; i <= steps; i++) {
        const angle = (i * 2 * Math.PI) / steps;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        await page.mouse.move(x, y);
    }

    await page.mouse.up();
}

async function drawTriangle(page, centerX, centerY, size) {
    const height = size * Math.sqrt(3) / 2; // Height of an equilateral triangle

    // Vertices of the triangle
    const p1x = centerX;
    const p1y = centerY - height / 2; // Top point
    const p2x = centerX - size / 2;
    const p2y = centerY + height / 2; // Bottom-left point
    const p3x = centerX + size / 2;
    const p3y = centerY + height / 2; // Bottom-right point

    await page.mouse.move(p1x, p1y);
    await page.mouse.down();
    await page.mouse.move(p2x, p2y);
    await page.mouse.move(p3x, p3y);
    await page.mouse.move(p1x, p1y); // Close the triangle
    await page.mouse.up();
}


// --- Main Bot Logic ---

async function skribblBot() {
    // Launch browser in non-headless mode for easier debugging
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Recommended for some environments
    });

    const page = await browser.newPage();

    try {
        await page.goto("https://skribbl.io/?b9CGS4Ps", { waitUntil: 'networkidle2' });
        console.log("🌐 Navigated to Skribbl.io");
async function getDrawingInstructions(word) {
    const promptText = `You are an expert Skribbl.io player and artist. Your goal is to generate simple, effective, and recognizable drawing instructions for the given word on a canvas.
    Assume the canvas is cleared before you draw.

    Provide step-by-step drawing instructions using basic mouse movements and relative coordinates:
    - Use centerX, centerY as the reference point (center of canvas).
    - Specify relative positions like "centerX + 50" or "centerY - 30".
    - Use basic shapes: circles, rectangles, lines, triangles.
    - Focus on the key features of the object/concept to make it quickly recognizable.
    - Keep it simple but recognizable for a quick drawing game.
    - Give specific coordinate instructions for each point.
    - Break down complex shapes into simpler components if necessary.
    - Prioritize drawing the most distinctive part of the object first.

    Here are some examples of good drawing instructions:

    Word: "tree"
    1. Draw line from centerX,centerY+50 to centerX,centerY-30 // Tree trunk
    2. Draw circle at centerX,centerY-50, radius 40 // Tree canopy
    3. Draw small circle at centerX+20,centerY-70, radius 10 // A small fruit (optional detail)

    Word: "house"
    1. Draw rectangle from centerX-60,centerY to centerX+60,centerY+70 // Main house body
    2. Draw triangle with points centerX-70,centerY to centerX+70,centerY to centerX,centerY-50 // Roof
    3. Draw rectangle from centerX-20,centerY+30 to centerX+20,centerY+70 // Door
    4. Draw rectangle from centerX+30,centerY+10 to centerX+50,centerY+25 // Window

    Word: "hook"
    1. Draw line from centerX-30,centerY-50 to centerX-30,centerY+30 // Main vertical part
    2. Draw line from centerX-30,centerY+30 to centerX+20,centerY+30 // Horizontal bottom part
    3. Draw line from centerX+20,centerY+30 to centerX+20,centerY+10 // Small vertical up-stroke
    4. Draw line from centerX+20,centerY+10 to centerX-10,centerY+10 // Top horizontal curl towards left

    Word to draw: ${word}`;

    try {
        const response = await shapes_client.chat.completions.create({
            model: "shapesinc/tenshi",
            messages: [{ role: "user", content: promptText }],
            temperature: 0.8, // Allow some creativity for drawing
            max_tokens: 500,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error(`❌ Error getting drawing instructions: ${error.message}`);
        return ""; // Return empty string on error
    }
}
        try {
            // Skribbl.io's "Play" button often has the ID 'buttonPlay'
            await page.waitForSelector('#buttonPlay', { visible: true, timeout: 15000 });
            await page.click('#buttonPlay');
            console.log("✅ Clicked the 'Play' button.");

            // Wait for a potential "OK" or "Join" button if a nickname modal appears
            // This selector is an educated guess, you might need to inspect it.
            await new Promise(resolve => setTimeout(resolve, 2000)); // Short pause for modal to appear
            const joinButton = await page.$('.btn[data-action="join"]'); // Example selector for a join button
            if (joinButton) {
                await joinButton.click();
                console.log("✅ Clicked a 'Join' button.");
            }

        } catch (e) {
            console.log(`⚠️ Initial play/join button not found or clicked (Error: ${e.message}). Attempting general screen clicks.`);
     
            await page.mouse.click(640, 400); // Center of the screen
            await new Promise(resolve => setTimeout(resolve, 1000));
            await page.mouse.click(640, 450); // Slightly below center
            console.log("✅ Performed general screen clicks for initial setup.");
        }

        // Wait a bit for the game lobby/actual game to load after joining
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log("🎮 Waiting for game lobby/start screen to load...");

        // --- Main Game Loop ---
        let step = 0;
        while (true) {
            step++;
            console.log(`\n--- Game Loop Step ${step} ---`);

            // Take a screenshot to analyze the current game state
            const screenshotPath = await takeScreenshot(page, step, "gameplay");
            const gameState = await detectGameState(screenshotPath);
            console.log(`🎮 Detected Game State: ${gameState}`);

            if (gameState.includes("GUESSING_READY")) {
                console.log("🤔 Game is in GUESSING_READY state. Attempting to make a guess.");
                // Add a small, explicit delay here to let the UI fully settle
                await new Promise(resolve => setTimeout(resolve, 1000));

                const guess = await guessFromImage(screenshotPath);

                if (guess && guess.length > 2) { // Ensure the guess is meaningful
                    console.log(`💭 My guess: "${guess}"`);
                    const submitted = await submitGuess(page, guess);
                    if (!submitted) {
                        console.log("🛑 Guess submission failed for this round. Continuing to next action.");
                        // Take another screenshot if guess submission fails consistently for debugging
                        await takeScreenshot(page, step, 'failed_guess_after_ready');
                    }
                } else {
                    console.log("❓ Could not determine a good guess from the drawing.");
                }
                // Wait a bit after guessing (or failing to guess) before the next loop iteration
                await new Promise(resolve => setTimeout(resolve, 3000));

            } else if (gameState.includes("DRAWING_TURN")) {
                console.log("🎨 It's my turn to draw!");
                // Add a small delay for the word selection UI to appear
                await new Promise(resolve => setTimeout(resolve, 1000));

                const wordInfo = await getWordToDrawFromScreen(screenshotPath);
                console.log(`📝 Word detection result: ${wordInfo}`);

                if (wordInfo && !wordInfo.includes("WORD_NOT_FOUND")) {
                    let wordToDraw = wordInfo.replace(/[^a-zA-Z\s]/g, '').trim();

                    // If multiple words are detected by the AI, try to select one
                    if (wordToDraw.includes(' ') && wordToDraw.split(' ').length > 1) {
                        const words = wordToDraw.split(' ');
                        console.log(`🎯 Multiple words detected: ${words.join(', ')}`);
                        wordToDraw = words[0]; // For simplicity, always pick the first word
                        const selected = await selectWordOption(page, wordToDraw);
                        if (!selected) {
                            console.log(`⚠️ Failed to select word option "${wordToDraw}". Proceeding with it anyway.`);
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for drawing canvas to be ready
                    }

                    console.log(`🖌️ Proceeding to draw word: "${wordToDraw}"`);
                    const instructions = await getDrawingInstructions(wordToDraw);

                    if (instructions && instructions.length > 0) {
                        const drawingSuccess = await drawBasedOnInstructions(page, instructions, wordToDraw);
                        if (drawingSuccess) {
                            console.log("✅ Successfully completed drawing.");
                        } else {
                            console.log("❌ Drawing failed.");
                        }
                    } else {
                        console.log("⚠️ No drawing instructions generated for the word.");
                    }
                } else {
                    console.log("❓ Could not identify the word to draw for my turn.");
                }
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait after drawing

            } else if (gameState.includes("WAITING") || gameState.includes("DRAWING_IN_PROGRESS") || gameState.includes("UNKNOWN")) {
                console.log("⏳ Waiting for next game action (someone else drawing or between rounds)...");
                // Just wait for the next screenshot to re-evaluate the state
                await new Promise(resolve => setTimeout(resolve, 5000));

            } else {
                console.log("❓ Unrecognized game state. Waiting and re-evaluating.");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Safety break to prevent infinite loops (for testing purposes)
            if (step > 100) { // Reduced steps for practical testing
                console.log("🛑 Reached maximum loop steps, stopping bot.");
                break;
            }
        }

    } catch (error) {
        console.error("❌ Critical error occurred in skribblBot main loop:", error);
    } finally {
        console.log("🏁 Closing browser...");
        await browser.close();
    }
}

// --- Start the Bot ---
console.log("🚀 Starting Skribbl.io Bot...");
skribblBot();