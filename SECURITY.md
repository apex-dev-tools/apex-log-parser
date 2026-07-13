# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public issue.** Instead, please email security@certinia.com with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

## Scope

This is a client-side parsing library with no network access, no file system access, and no code execution. The primary security concern is denial-of-service via maliciously crafted log input (e.g., extremely large or deeply nested logs causing excessive memory or CPU usage).
