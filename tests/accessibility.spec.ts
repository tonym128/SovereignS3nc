import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Audits (axe-core)', () => {

    const pagesToAudit = [
        { name: 'Demo Portal Landing', path: '/' },
        { name: 'Interactive Playground', path: '/playground/' },
        { name: 'Social Demo (Login)', path: '/social/' },
        { name: 'Social Local Demo', path: '/social-local/' },
        { name: 'Banky Demo', path: '/banky/' },
        { name: 'Board Demo', path: '/board/' },
        { name: 'Blog Reader Demo', path: '/blog/' },
        { name: 'Blog Editor Demo', path: '/blog/editor.html' },
    ];

    for (const pageInfo of pagesToAudit) {
        test(`Audit ${pageInfo.name} for critical and serious violations`, async ({ page }) => {
            await page.goto(pageInfo.path, { waitUntil: 'domcontentloaded' });
            // Allow UI components to mount and render
            await page.waitForTimeout(1000);

            const accessibilityScanResults = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze();

            const severeViolations = accessibilityScanResults.violations.filter(
                v => v.impact === 'critical' || v.impact === 'serious'
            );

            if (severeViolations.length > 0) {
                console.error(`\n❌ Accessibility violations found on ${pageInfo.name} (${pageInfo.path}):`);
                for (const v of severeViolations) {
                    console.error(` - [${v.impact?.toUpperCase()}] ${v.id}: ${v.help} (${v.helpUrl})`);
                    for (const node of v.nodes) {
                        console.error(`   Target: ${node.target.join(' ')}`);
                        console.error(`   HTML: ${node.html}`);
                        console.error(`   Failure Summary: ${node.failureSummary}`);
                    }
                }
            }

            expect(severeViolations).toEqual([]);
        });
    }
});
