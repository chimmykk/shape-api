#!/usr/bin/env node

import { config } from "dotenv";
import axios from "axios";
import readline from "readline";

// Load environment variables from .env file
config();

async function main() {
    try {
        const shape_api_key = process.env.SHAPESINC_API_KEY;
        const shape_username = process.env.SHAPESINC_SHAPE_USERNAME;

        // Check for required environment variables
        if (!shape_api_key) {
            throw new Error("SHAPESINC_API_KEY not found in .env");
        }

        if (!shape_username) {
            throw new Error("SHAPESINC_SHAPE_USERNAME not found in .env");
        }

     
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Typing effect function to emulate streaming
        async function streamTextToTerminal(text, delay = 40) { // adjust based on your requirements
            for (const char of text) {
                process.stdout.write(char);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            process.stdout.write('\n');
        }

        // Send message to Shapes API and emulate streaming response
        async function sendMessage(text) {
            try {
                const response = await axios.post(
                    "https://api.shapes.inc/v1/chat/completions",
                    {
                        model: `shapesinc/${shape_username}`,
                        messages: [{ role: "user", content: text }]
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${shape_api_key}`,
                            "Content-Type": "application/json"
                        }
                    }
                );

                if (response.data.choices && response.data.choices.length > 0) {
                    const message = response.data.choices[0].message.content;
                    await streamTextToTerminal(message);
                } else {
                    console.log("No choices in response:", response.data);
                }
            } catch (error) {
                console.error(
                    "Error:",
                    error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message
                );
            }
        }

    
        function promptUser() {
            rl.question("You: ", async (input) => {
                if (input.toLowerCase() === "exit") {
                    rl.close();
                    return;
                }

                if (input.trim()) {
                    await sendMessage(input);
                } else {
                    console.log("Please enter a non-empty message.");
                }

                promptUser();
            });
        }

    
        console.log("🔷 Shapes API Chat (Type 'exit' to quit)");
        promptUser();

 
        rl.on("close", () => {
            console.log("\nExiting chat.");
            process.exit(0);
        });

    } catch (error) {
        console.error("Error:", error.message);
    }
}

main();
