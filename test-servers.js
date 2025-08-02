#!/usr/bin/env node

const http = require('http');

async function testServer(url, name) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      console.log(`✅ ${name} server is running (Status: ${res.statusCode})`);
      resolve(true);
    });
    
    req.on('error', (err) => {
      console.log(`❌ ${name} server is not responding: ${err.message}`);
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      console.log(`⏰ ${name} server timeout`);
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  console.log('🔍 Testing CodarMeet servers...\n');
  
  const backendOk = await testServer('http://localhost:3002', 'Backend Signaling');
  const frontendOk = await testServer('http://localhost:5173', 'Frontend Dev');
  
  console.log('\n📊 Server Status Summary:');
  console.log(`Backend Signaling Server: ${backendOk ? '✅ Running' : '❌ Down'}`);
  console.log(`Frontend Dev Server: ${frontendOk ? '✅ Running' : '❌ Down'}`);
  
  if (backendOk && frontendOk) {
    console.log('\n🎉 All servers are running! You can now test the video calling functionality.');
    console.log('🌐 Open http://localhost:5173 in two browser tabs/windows to test the video call.');
    console.log('📖 See VIDEO_CALL_README.md for detailed testing instructions.');
  } else {
    console.log('\n⚠️  Some servers are not running. Please check the logs above.');
    if (!backendOk) {
      console.log('   To start backend: npm run start:backend');
    }
    if (!frontendOk) {
      console.log('   To start frontend: npm run start:frontend');
    }
    console.log('   To start both: npm run start:all');
  }
}

main().catch(console.error);