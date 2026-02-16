/**
 * Master Test Script - @baileys-store/core
 *
 * Interactive menu to test all storage adapters
 */

import * as readline from 'readline';
import { spawn } from 'child_process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printMenu() {
  console.clear();
  console.log('\n' + '═'.repeat(80));
  console.log('🧪 @baileys-store/core - Test Suite');
  console.log('═'.repeat(80) + '\n');

  console.log('Choose a test to run:\n');
  console.log('  1️⃣  Redis Adapter Test');
  console.log('      - Storage: Redis only');
  console.log('      - Features: Hot cache, TTL, encryption');
  console.log('');

  console.log('  2️⃣  MongoDB Adapter Test');
  console.log('      - Storage: MongoDB only');
  console.log('      - Features: Durable storage, TTL indexes, encryption');
  console.log('');

  console.log('  3️⃣  Hybrid Adapter Test (Recommended)');
  console.log('      - Storage: Redis + MongoDB');
  console.log('      - Features: Hot cache + Cold storage, best of both');
  console.log('');

  console.log('  4️⃣  Kafka Write-Behind Test');
  console.log('      - Storage: Hybrid + Kafka');
  console.log('      - Features: Async write-behind with Kafka producer');
  console.log('');

  console.log('  5️⃣  NPM Import Test');
  console.log('      - Validates published package from npm');
  console.log('      - Tests: Import from @luoarch/baileys-store-core@rc');
  console.log('');

  console.log('  6️⃣  Run All Tests (Sequential)');
  console.log('      - Runs all tests one after another');
  console.log('');

  console.log('  7️⃣  Exit');
  console.log('');
  console.log('═'.repeat(80) + '\n');
}

function runTest(scriptName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Starting test: ${scriptName}\n`);

    const child = spawn('yarn', ['tsx', `test-scripts/${scriptName}`], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      if (code === 0 || code === 130) {
        // 130 = SIGINT (Ctrl+C)
        resolve();
      } else {
        reject(new Error(`Test failed with code ${code}`));
      }
    });
  });
}

async function runAllTests() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔄 Running all tests sequentially...');
  console.log('═'.repeat(80) + '\n');

  const tests = [
    'test-redis.ts',
    'test-mongodb.ts',
    'test-hybrid.ts',
    'test-kafka.ts',
    'test-from-npm.ts',
  ];

  for (const test of tests) {
    try {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`Running: ${test}`);
      console.log('─'.repeat(80) + '\n');

      await runTest(test);

      console.log('\n✅ Test completed\n');

      // Wait for user confirmation before next test
      await new Promise<void>((resolve) => {
        rl.question('\nPress ENTER to continue to next test... ', () => {
          resolve();
        });
      });
    } catch (error) {
      console.error(`\n❌ Test failed: ${error}\n`);

      const continueTests = await new Promise<boolean>((resolve) => {
        rl.question('\nContinue with remaining tests? (y/n): ', (answer) => {
          resolve(answer.toLowerCase() === 'y');
        });
      });

      if (!continueTests) {
        break;
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('✨ All tests completed!');
  console.log('═'.repeat(80) + '\n');
}

async function main() {
  let running = true;

  while (running) {
    printMenu();

    const choice = await new Promise<string>((resolve) => {
      rl.question('Enter your choice (1-7): ', resolve);
    });

    try {
      switch (choice.trim()) {
        case '1':
          await runTest('test-redis.ts');
          break;

        case '2':
          await runTest('test-mongodb.ts');
          break;

        case '3':
          await runTest('test-hybrid.ts');
          break;

        case '4':
          await runTest('test-kafka.ts');
          break;

        case '5':
          await runTest('test-from-npm.ts');
          break;

        case '6':
          await runAllTests();
          break;

        case '7':
          console.log('\n👋 Goodbye!\n');
          running = false;
          break;

        default:
          console.log('\n❌ Invalid choice. Please select 1-7.\n');
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
      }

      if (running && choice !== '6') {
        console.log('\n' + '─'.repeat(80));
        const again = await new Promise<string>((resolve) => {
          rl.question('\nRun another test? (y/n): ', resolve);
        });

        if (again.toLowerCase() !== 'y') {
          console.log('\n👋 Goodbye!\n');
          running = false;
        }
      }
    } catch (error) {
      console.error('\n❌ Error:', error);

      const retry = await new Promise<string>((resolve) => {
        rl.question('\nReturn to menu? (y/n): ', resolve);
      });

      if (retry.toLowerCase() !== 'y') {
        console.log('\n👋 Goodbye!\n');
        running = false;
      }
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
