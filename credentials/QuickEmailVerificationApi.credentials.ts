import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class QuickEmailVerificationApi implements ICredentialType {
	name = 'quickEmailVerificationApi';
	displayName = 'QuickEmailVerification API';
	documentationUrl = 'https://docs.quickemailverification.com/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API key from QuickEmailVerification',
		},
		{
			displayName: 'Enable Per-Address Caching',
			name: 'enableCache',
			type: 'boolean',
			default: true,
			description: 'Whether to cache verification results for individual email addresses',
		},
		{
			displayName: 'Individual Cache Retention Period (days)',
			name: 'cacheTTL',
			type: 'number',
			default: 30,
			description: 'Number of days to retain cached verification results for each email address',
			displayOptions: {
				show: {
					enableCache: [true],
				},
			},
		},
		{
			displayName: 'Enable Domain Accept-All Caching',
			name: 'enableDomainCache',
			type: 'boolean',
			default: true,
			description: 'Whether to cache domains that accept all email addresses',
		},
		{
			displayName: 'Domain Cache Retention Period (days)',
			name: 'domainCacheTTL',
			type: 'number',
			default: 90,
			description: 'Number of days to retain cached information about domains that accept all emails',
			displayOptions: {
				show: {
					enableDomainCache: [true],
				},
			},
		},
	];
}
