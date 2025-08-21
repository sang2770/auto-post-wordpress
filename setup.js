#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function setup() {
    console.log('🚀 Auto Store Creator Setup\n');
    console.log('This script will help you configure the application.\n');

    const envPath = path.join(__dirname, '.env');

    // Read existing .env if it exists
    let existingConfig = {};
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                existingConfig[key.trim()] = value.trim();
            }
        });
    }

    console.log('📝 WordPress Configuration:');
    const wordpressUrl = await question(`WordPress URL (${existingConfig.WORDPRESS_URL || 'https://coponeer.com'}): `);
    const wordpressUsername = await question(`WordPress Username (${existingConfig.WORDPRESS_USERNAME || 'your_username'}): `);
    const wordpressPassword = await question(`WordPress Password: `);

    console.log('\n� Google Sheets Setup (No API Key Required!):');
    console.log('This app now uses "Publish to web" functionality - much simpler!');
    console.log('To set up your Google Sheet:');
    console.log('1. Open your Google Sheet');
    console.log('2. Go to File > Share > Publish to web');
    console.log('3. Choose "Entire Document" and "Web page" or "CSV"');
    console.log('4. Check "Automatically republish when changes are made"');
    console.log('5. Click "Publish" and copy the URL');
    console.log('6. Make sure sharing is set to "Anyone with the link can view"\n');

    console.log('⚙️  Server Configuration:');
    const port = await question(`Port (${existingConfig.PORT || '3000'}): `);
    const pollingInterval = await question(`Polling interval in minutes (${existingConfig.POLLING_INTERVAL || '5'}): `);

    // Create .env content
    const envContent = `# WordPress Configuration
WORDPRESS_URL=${wordpressUrl || existingConfig.WORDPRESS_URL || 'https://coponeer.com'}
WORDPRESS_USERNAME=${wordpressUsername || existingConfig.WORDPRESS_USERNAME || 'your_username'}
WORDPRESS_PASSWORD=${wordpressPassword || existingConfig.WORDPRESS_PASSWORD || 'your_password'}

# Server Configuration
PORT=${port || existingConfig.PORT || '3000'}

# Polling interval in minutes (default: 5)
POLLING_INTERVAL=${pollingInterval || existingConfig.POLLING_INTERVAL || '5'}`;

    // Write .env file
    fs.writeFileSync(envPath, envContent);

    console.log('\n✅ Configuration saved to .env file');
    console.log('\n🚀 To start the application:');
    console.log('   npm start');
    console.log('\n📖 Then open your browser to:');
    console.log(`   http://localhost:${port || existingConfig.PORT || '3000'}`);
    console.log('\n📋 Make sure your Google Sheets is publicly readable or shared with the API key.');

    rl.close();
}

setup().catch(console.error);
