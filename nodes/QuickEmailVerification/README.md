# QuickEmailVerification Node

This node allows you to verify email addresses using the QuickEmailVerification API.

## Configuration

### API Credentials

1. Sign up for an account at [QuickEmailVerification](https://quickemailverification.com)
2. Get your API key from the dashboard
3. Use the API key in n8n credentials

### Cache Settings

The node includes caching functionality to improve performance and reduce API calls:

- **Enable Caching**: Toggle to enable/disable caching (default: enabled)
- **Cache TTL**: Number of days to keep cached results (default: 30 days)

## Usage

### Basic Email Verification

1. Add the node to your workflow
2. Select 'Verify Email' operation
3. Enter the email address to verify
4. Execute the node

### Batch Email Verification

1. Connect a node that outputs email addresses (e.g., CSV Read, Spreadsheet)
2. Map the email field to the node's email parameter
3. Execute the workflow

## Response Format

The node returns a JSON object with the following fields:

```json
{
    "result": "valid",
    "reason": "accepted_email",
    "disposable": false,
    "accept_all": false,
    "role": false,
    "free": false,
    "email": "test@example.com",
    "user": "test",
    "domain": "example.com",
    "mx_record": true,
    "mx_domain": "example.com",
    "safe_to_send": true,
    "did_you_mean": "",
    "success": true,
    "message": null
}
```

## Troubleshooting

### Common Issues

1. **Invalid API Key**
   - Verify your API credentials
   - Check if your subscription is active

2. **Rate Limit Exceeded**
   - Check your API plan limits
   - Enable caching to reduce API calls
   - Implement delays between batch operations

3. **Cache Issues**
   - Verify cache settings in credentials
   - Clear node cache by disabling and re-enabling caching
   - Check available system memory

### Error Messages

- `Invalid API key`: Check your API credentials
- `Rate limit exceeded`: Wait before making more requests
- `Email verification failed`: The API couldn't verify the email
- `Cache Error`: Issue with the caching system

## Best Practices

1. Enable caching for frequently checked emails
2. Use batch operations for multiple emails
3. Handle rate limits with appropriate delays
4. Validate email format before verification
5. Monitor cache usage for optimal performance 
