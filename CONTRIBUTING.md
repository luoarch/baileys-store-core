# Contributing to @baileys-store/core

Thank you for your interest in contributing! 🎉

## 🤝 How Can I Contribute?

### Reporting Bugs 🐛

Before creating bug reports, please check the [issue list](https://github.com/luoarch/baileys-store-core/issues) as you might find that you don't need to create one.

**When creating a bug report, include:**

- Use a clear and descriptive title
- Describe the exact steps to reproduce the problem
- Provide specific examples to demonstrate the steps
- Describe the behavior you observed and what behavior you expected
- Include Node.js version, package version, and OS

### Suggesting Enhancements 💡

Enhancement suggestions are tracked as [GitHub issues](https://github.com/luoarch/baileys-store-core/issues).

**Create an enhancement suggestion with:**

- Clear and descriptive title
- Step-by-step description of the suggested enhancement
- Specific examples to demonstrate the steps
- Current behavior vs. expected behavior
- Explain why this enhancement would be useful

### Pull Requests 🔄

The process for submitting a pull request:

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies:** `yarn install`
3. **Make your changes:**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed
4. **Test your changes:**
   ```
   yarn test
   yarn lint
   yarn build
   ```
5. **Commit using Conventional Commits:**
   ```
   git commit -m "feat: add Redis cluster support"
   git commit -m "fix: handle connection timeout in MongoDB"
   git commit -m "docs: update installation instructions"
   ```
6. **Push to your fork** and submit a pull request

## 📋 Pull Request Guidelines

### Before Submitting

- [ ] Code follows the project's style guidelines
- [ ] Self-review of your own code
- [ ] Comments added in hard-to-understand areas
- [ ] Documentation updated (if applicable)
- [ ] Tests added/updated and passing
- [ ] No new warnings generated
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

### PR Title Format

Use one of these prefixes:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `style:` formatting, missing semicolons, etc
- `refactor:` code change that neither fixes a bug nor adds a feature
- `perf:` performance improvement
- `test:` adding missing tests
- `chore:` updating build tasks, package manager configs, etc

**Examples:**

- `feat: add support for Redis Sentinel`
- `fix: prevent race condition in message queue`
- `docs: add MongoDB connection examples`

## 🧪 Development Setup

1. Clone your fork:

   ```
   git clone https://github.com/YOUR_USERNAME/baileys-store-core.git
   cd baileys-store-core
   ```

2. Add upstream remote:

   ```
   git remote add upstream https://github.com/luoarch/baileys-store-core.git
   ```

3. Install dependencies:

   ```
   yarn install
   ```

4. Create a branch:
   ```
   git checkout -b feature/my-new-feature
   ```

## 🏗️ Project Structure

```
baileys-store-core/
├── src/
│   ├── stores/        # Store implementations
│   ├── types/         # TypeScript definitions
│   └── utils/         # Utility functions
├── tests/
│   ├── unit/          # Unit tests
│   ├── integration/   # Integration tests
│   └── e2e/           # End-to-end tests
└── docs/              # Documentation
```

## 🎨 Code Style

- Use TypeScript
- Follow ESLint rules (`yarn lint`)
- Use Prettier for formatting (`yarn format`)
- No `any` types in production code
- Prefer `const` over `let`
- Use async/await over promises

## ✅ Testing

- Write tests for all new code
- Maintain or improve code coverage (target: 80%)
- Run tests before submitting PR: `yarn test`
- Coverage report: `yarn test:coverage`

## 📖 Documentation

- Update README.md if you change functionality
- Add JSDoc comments to public APIs
- Update CHANGELOG.md (automated via semantic-release)
- Include code examples in documentation

## 🔒 Security

Found a vulnerability? Please **do not** open a public issue.

Email security concerns to: luoarch@protonmail.com

See [SECURITY.md](./SECURITY.md) for our security policy.

## 💬 Getting Help

- [GitHub Discussions](https://github.com/luoarch/baileys-store-core/discussions) for questions
- [Issues](https://github.com/luoarch/baileys-store-core/issues) for bug reports
- Tag maintainers: @luoarch

## 🌟 Recognition

All contributors are recognized using [@all-contributors bot](https://allcontributors.org/).

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making this project better!** 🙌
