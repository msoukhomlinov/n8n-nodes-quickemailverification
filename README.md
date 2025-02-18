# n8n-nodes-quickemailverification

This is an n8n community node for QuickEmailVerification API. It provides email verification functionality with caching support.

## Installation

Follow these steps to install the node:

```bash
# Install from npm
npm install n8n-nodes-quickemailverification

# Or install from source
npm install
```

## Features

- Email verification using QuickEmailVerification API
- Response caching with configurable TTL
- Rate limiting and retry handling
- Secure credential storage

## Configuration

1. Get your API key from [QuickEmailVerification](https://quickemailverification.com)
2. Add your API credentials in n8n credentials manager
3. Configure optional caching settings:
   - Enable/disable caching
   - Set cache TTL (default: 30 days)

## Usage

1. Add the QuickEmailVerification node to your workflow
2. Configure the node with your credentials
3. Connect input nodes that provide email addresses
4. Use output for email verification results

## Response Format

The node returns verification results including:
- Validation status
- Detailed reason
- Additional email information (disposable, role-based, etc.)
- MX record information

## License

[MIT](LICENSE) 
