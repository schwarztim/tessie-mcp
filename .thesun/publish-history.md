# tessie MCP Publish History

This file tracks where documentation has been published.
DO NOT commit to public repositories.

## Local
- Path: /Users/timothy.schwarz/Scripts/mcp-servers/tessie-mcp-local
- Forked from: https://github.com/keithah/tessie-mcp
- Created: 2026-01-16T08:01:07.980Z
- Version: 2.0.1

## Fixes Applied - 2026-01-16T08:01:07.980Z

### Issues Fixed
- Test configuration using wrong property name (TESSIE_API_KEY vs accessToken)
- 5 security vulnerabilities in dependencies
- Deprecated ts-jest configuration format
- Missing HTTP connection pooling for performance

### Performance Improvements
- Added HTTP/HTTPS keep-alive agents
- Connection pooling with 50 max sockets, 10 free sockets
- 30-second keep-alive timeout
- Significant latency reduction for multi-vehicle setups

### Security Fixes
- Updated @modelcontextprotocol/sdk (DNS rebinding + ReDoS vulnerabilities)
- Updated body-parser (DoS vulnerability)
- Updated glob (command injection vulnerability)
- Updated js-yaml (prototype pollution)
- Updated qs (DoS via memory exhaustion)

### Documentation Updated
- Local: ✅ (CHANGELOG.md updated with v2.0.1 entry)
- Confluence: ❌ (not applicable)
- GitHub: 🔄 (pending fork creation)

## Files Modified
- src/tessie-client.ts (added HTTP/HTTPS agents with keep-alive)
- tests/tools.test.ts (fixed config property name)
- tests/manage_vehicle_command.test.ts (fixed config property name)
- package.json (updated ts-jest config, bumped version to 2.0.1)
- CHANGELOG.md (added v2.0.1 entry)
- package-lock.json (dependency updates via npm audit fix)

## Configuration Fix Applied - 2026-01-16T08:16:00Z

### Issue
- Original config used `npx @keithah/tessie-mcp` but package not published to npm
- MCP server was failing to start in Claude Code

### Solution
- Built stdio transport locally with all improvements
- Updated user-mcps.json to use local path with Smithery config format
- Config now uses: `accessToken=<key>` as command-line argument (Smithery style)

### Final Configuration
```json
{
  "command": "/Users/timothy.schwarz/Scripts/mcp-servers/tessie-mcp-local/.smithery/stdio/index.cjs",
  "args": ["accessToken=4HfLAc7Rka4M7NKIDpoaEd5N6BwlgHX4"]
}
```

## Next Steps
1. ✅ All fixes applied and documented
2. ✅ Fork repository to user's GitHub (https://github.com/schwarztim/tessie-mcp)
3. ✅ Push improvements to forked repo
4. ✅ MCP server working correctly in Claude Code
5. 🔄 Optional: Consider submitting PR to upstream
