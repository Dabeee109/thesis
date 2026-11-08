const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:/Users/USER/.gemini/antigravity/brain/7c316e1b-82ab-49f2-aea8-8027b9a42a45/.system_generated/logs/transcript_full.jsonl'),
  crlfDelay: Infinity
});

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.step_index === 6522) {
      fs.writeFileSync('scratch/menu_refresh_prompt.txt', obj.content);
      console.log('Successfully saved prompt to scratch/menu_refresh_prompt.txt');
      process.exit(0);
    }
  } catch (err) {}
});

