import { writeFile } from 'node:fs/promises';
import { COMMANDS } from '../src/cli.js';
import { OPERATIONS, operationInfo } from '../src/operations.js';
const clean=s=>String(s||'').replaceAll('|','\\|');
const rows=COMMANDS.map(c=>`| \`${c.name}\` | ${clean(c.description)} | ${c.name==='agent call'?'依操作；写入需 --yes':c.write?'写入，需 --yes':'查询/本机'} | ${clean(c.usage)} |`);
await writeFile(new URL('../docs/commands.md',import.meta.url),`# 命令目录\n\n共 ${COMMANDS.length} 条命令。由 \`npm run docs\` 生成。别名不重复计数。\n\n使用 \`zspace <命令> --help\` 查看参数。新增操作也可用 \`--params '{"字段":"值"}'\` 或 \`--param 字段=值\`；数组与对象使用 JSON。操作字段 \`config\` 的命名选项是 \`--spec\`，避免与全局凭证文件 \`--config\` 冲突。\n\n\`zspace api describe <domain.action>\` 输出准确的输入 schema。原有文件命令继续使用位置参数。工具数量、应用覆盖程度与验收次数是不同指标；见 [覆盖表](coverage.md) 和 [MCP 文档](mcp.md)。\n\n| 命令 | 用途 | 行为 | 参数 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`);
await writeFile(new URL('../docs/operations.json',import.meta.url),JSON.stringify([...OPERATIONS.values()].map(operationInfo),null,2)+'\n');
console.log(`Documented ${COMMANDS.length} commands and ${OPERATIONS.size} operations.`);
