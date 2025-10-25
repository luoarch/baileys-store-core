#!/bin/bash
set -e

echo "🚀 Publishing @luoarch/baileys-store-core v1.0.0-rc.1"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 1. Verificar login npm
echo -e "${YELLOW}Step 1/9: Checking npm login...${NC}"
NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [ -z "$NPM_USER" ]; then
    echo -e "${RED}❌ Not logged in to npm. Run 'npm login' first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Logged in as $NPM_USER${NC}"

# Verificar acesso à org
echo -e "${YELLOW}Checking org access...${NC}"
if npm access ls-packages @luoarch 2>/dev/null | grep -q "@luoarch"; then
    echo -e "${GREEN}✓ Has access to @luoarch organization${NC}"
else
    echo -e "${RED}❌ No access to @luoarch. Check npm org settings.${NC}"
    exit 1
fi
echo ""

# 2. Limpar e build
echo -e "${YELLOW}Step 2/9: Clean build...${NC}"
npm run clean
npm run build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# 3. Rodar testes
echo -e "${YELLOW}Step 3/9: Running tests...${NC}"
npm test
echo -e "${GREEN}✓ Tests passed${NC}"
echo ""

# 4. Lint
echo -e "${YELLOW}Step 4/9: Linting...${NC}"
npx eslint src/**/*.ts
echo -e "${GREEN}✓ Lint passed${NC}"
echo ""

# 5. Dry-run pack
echo -e "${YELLOW}Step 5/9: Checking package contents...${NC}"
npm pack --dry-run
echo -e "${GREEN}✓ Package contents verified${NC}"
echo ""

# 6. Commit changes
echo -e "${YELLOW}Step 6/9: Committing release...${NC}"
git add package.json CHANGELOG.md README.md CITATION.cff
git commit -m "chore: release v1.0.0-rc.1

- First release candidate for v1.0.0
- Published as @luoarch/baileys-store-core
- Seeking community feedback
- See CHANGELOG.md for details"
echo -e "${GREEN}✓ Committed${NC}"
echo ""

# 7. Create git tag
echo -e "${YELLOW}Step 7/9: Creating git tag...${NC}"
git tag -a v1.0.0-rc.1 -m "Release Candidate 1 for v1.0.0

Features:
- Hybrid storage (Redis + MongoDB)
- Circuit breaker resilience
- Transactional outbox pattern
- Thread-safe Prometheus metrics
- 49 comprehensive tests

Published as @luoarch/baileys-store-core
Seeking community validation before stable release."
echo -e "${GREEN}✓ Tag created${NC}"
echo ""

# 8. Push to GitHub
echo -e "${YELLOW}Step 8/9: Pushing to GitHub...${NC}"
git push origin main
git push origin v1.0.0-rc.1
echo -e "${GREEN}✓ Pushed to GitHub${NC}"
echo ""

# 9. Publish to npm
echo -e "${YELLOW}Step 9/9: Publishing to npm (tag: next)...${NC}"
npm publish --tag next --access public
echo -e "${GREEN}✓ Published to npm!${NC}"
echo ""

# Success message
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 Successfully published @luoarch/baileys-store-core@1.0.0-rc.1${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""
echo "📦 Installation command for testers:"
echo "   npm install @luoarch/baileys-store-core@next"
echo ""
echo "🔗 Next steps:"
echo "   1. Create GitHub Release (pre-release)"
echo "   2. Create Discussion post for feedback"
echo "   3. Update README badges"
echo "   4. Zenodo will auto-archive and generate DOI"
echo ""
echo "🌐 Package URL:"
echo "   https://www.npmjs.com/package/@luoarch/baileys-store-core"
echo ""
echo -e "${BLUE}💡 Remember to create GitHub Release manually as pre-release!${NC}"
