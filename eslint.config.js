import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const baseRules = {
    'no-undef': 'error',
    'no-unused-vars': ['error', {
        varsIgnorePattern: '^React$',
        argsIgnorePattern: '^_',
        caughtErrors: 'none'
    }]
};

export default [
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true }
            },
            globals: globals.browser
        },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            ...baseRules,
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error'
        }
    },
    {
        files: ['server/**/*.js', 'worker/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.worker
            }
        },
        rules: baseRules
    },
    {
        files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.worker,
                ...globals.browser
            }
        },
        rules: baseRules
    }
];
