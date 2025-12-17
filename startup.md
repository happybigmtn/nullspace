# Startup Instructions

Run each of these blocks in a separate terminal window.

### Terminal 1: Simulator (The Blockchain Node)
```bash
ID="92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55"
./target/release/nullspace-simulator --host 0.0.0.0 -i $ID -p 8080
```

### Terminal 2: Executor (The Game Logic)
```bash
ID="92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55"
./target/release/dev-executor -i $ID -u http://127.0.0.1:8080
```

### Terminal 3: Frontend (Website)
```bash
cd website
export VITE_IDENTITY="92b050b6fbe80695b5d56835e978918e37c8707a7fad09a01ae782d4c3170c9baa4c2c196b36eac6b78ceb210b287aeb0727ef1c60e48042142f7bcc8b6382305cd50c5a4542c44ec72a4de6640c194f8ef36bea1dbed168ab6fd8681d910d55"
export VITE_URL="http://127.0.0.1:8080"
npm run dev -- --host 0.0.0.0 --port 3000
```
