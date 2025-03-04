## devnet sol 链 Raydium swap 数据

```
npm install
npm start

// show in logs/*.log
```

## swap 数据

`logs/swaps.log`

```json
{
  "timestamp": "2025-02-13T07:45:25.331Z",
  "type": "swap",
  "data": {
    "type": "swap",
    "input": {
      "token": "SOL",
      "amount": 62.5687,
      "decimals": 9
    },
    "output": {
      "token": "4QGCZU9vto49NwohfTLQd8JA6B49dacpMyNhfFB1W9We",
      "amount": 789570864,
      "decimals": 6
    },
    "timestamp": "2025-02-12T10:40:26.000Z"
  }
}

{
  "timestamp": "2025-02-13T07:45:25.717Z",
  "type": "swap",
  "data": {
    "type": "swap",
    "input": {
      "token": "SOL",
      "amount": 62.5687,
      "decimals": 9
    },
    "output": {
      "token": "4QGCZU9vto49NwohfTLQd8JA6B49dacpMyNhfFB1W9We",
      "amount": 789570864,
      "decimals": 6
    },
    "timestamp": "2025-02-12T10:40:26.000Z"
  }
}

{
  "timestamp": "2025-02-13T07:45:26.321Z",
  "type": "swap",
  "data": {
    "type": "swap",
    "input": {
      "token": "SOL",
      "amount": 62.5687,
      "decimals": 9
    },
    "output": {
      "token": "4QGCZU9vto49NwohfTLQd8JA6B49dacpMyNhfFB1W9We",
      "amount": 789570864,
      "decimals": 6
    },
    "timestamp": "2025-02-12T10:40:26.000Z"
  }
}


```

```javascript

/**
 * 程序运行流程：
 * 
 * 1. 监听区块
 *    - 通过 connection.onSlotChange 监听新区块
 *    - 每个新区块调用 processNewSlot
 * 
 * 2. 处理区块中的交易
 *    - 获取区块中的所有交易
 *    - 过滤出包含 Raydium 程序的交易 (CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW)
 * 
 * 3. 识别 Swap 交易
 *    a. 检查交易中的指令
 *       - 提取指令数据的前 8 字节作为 discriminator 
 *       - 通过 RAYDIUM_INSTRUCTION_TYPES 映射表识别指令类型
 * 
 *    b. 解析 Swap 指令
 *       - 检查交易前后的代币余额变化
 *       - 确定输入和输出代币
 *       - 计算交易金额
 * 
 * 4. 记录交易信息
 *    - 使用 Logger 记录交易详情
 *    - 保存到不同的日志文件中
 */

// Swap 交易识别过程示例：
// 1. 交易数据
//    {
//      programId: 'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW',  // Raydium 程序
//      data: '8fbe5adac41e33de...',  // 指令数据
//      accounts: [...]  // 相关账户
//    }
//
// 2. 指令识别
//    - 提取 data 前8字节: '8fbe5adac41e33de'
//    - 查表得知这是 SwapBaseInput 指令
//
// 3. 余额变化追踪
//    - 记录交易前所有代币账户余额
//    - 记录交易后所有代币账户余额
//    - 计算变化：
//      * 负值变化 = 用户支付的代币 (输入)
//      * 正值变化 = 用户收到的代币 (输出)
//
// 4. 确认 Swap
//    - 检查程序日志中的 "Instruction: SwapBaseInput"
//    - 验证 TransferChecked 指令的执行
//    - 确认代币实际转移完成
```
