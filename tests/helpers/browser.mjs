export function testBrowserOptions() {
    return {
        headless: true,
        ...(process.env.MARCHCENTER_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' })
    };
}
