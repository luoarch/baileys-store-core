#!/usr/bin/env tsx
/**
 * Denylist Scanner - CI enforcement for deprecated code and inclusive language
 *
 * Scans source files for patterns defined in denylist.json
 * Exit code 1 if any errors found, 0 otherwise
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface Pattern {
  pattern: string;
  replacement: string;
  reason: string;
}

interface Config {
  version: string;
  patterns: Record<string, Pattern[]>;
  exclude: string[];
  severity: Record<string, 'error' | 'warning'>;
}

interface Violation {
  file: string;
  line: number;
  match: string;
  category: string;
  replacement: string;
  reason: string;
  severity: 'error' | 'warning';
}

function loadConfig(): Config {
  return JSON.parse(readFileSync('denylist.json', 'utf-8'));
}

function shouldExclude(path: string, excludes: string[]): boolean {
  return excludes.some((ex) => path.includes(ex) || path.endsWith(ex.replace('*', '')));
}

function getFiles(dir: string, excludes: string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (shouldExclude(fullPath, excludes)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getFiles(fullPath, excludes));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function scan(): void {
  const config = loadConfig();
  const files = getFiles('src', config.exclude);
  const violations: Violation[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (const [category, patterns] of Object.entries(config.patterns)) {
      const severity = config.severity[category] ?? 'warning';
      for (const { pattern, replacement, reason } of patterns) {
        const regex = new RegExp(pattern, 'g');
        lines.forEach((line, idx) => {
          let match;
          while ((match = regex.exec(line)) !== null) {
            violations.push({
              file: relative(process.cwd(), file),
              line: idx + 1,
              match: match[0],
              category,
              replacement,
              reason,
              severity,
            });
          }
        });
      }
    }
  }

  // Report
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  for (const v of violations) {
    const icon = v.severity === 'error' ? 'ERROR' : 'WARN';
    console.log(`[${icon}] ${v.file}:${v.line} - "${v.match}"`);
    console.log(`   Replace with: ${v.replacement}`);
    console.log(`   Reason: ${v.reason}\n`);
  }

  console.log(`\nTotal: ${errors.length} errors, ${warnings.length} warnings`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

scan();
