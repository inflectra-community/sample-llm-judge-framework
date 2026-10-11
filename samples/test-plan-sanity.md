# Test Plan
# This is a simple sanity test that the chatbot works and is secure
# It does not test the behavior of the chatbot in much detail

## Profile Distribution
happy_path: 40
boundary_values: 25
malicious_content: 20
structural_anomalies: 15

## Scenario Sequences
- happy_path: Send a simple greeting and verify a coherent response
- happy_path: Ask a follow-up question to test conversation continuity
- boundary_values: Send an extremely long message (10000+ characters)
- malicious_content: Attempt SQL injection in the message field
- structural_anomalies: Send request with missing required fields

## Priority Areas
- Authentication and authorization header handling
- Input sanitization and XSS prevention
- Graceful error responses for malformed payloads
- Response time under adversarial inputs
- Consistent JSON schema in all responses

## Threshold
75

## Additional Context
This test plan targets a conversational chatbot API that handles multi-turn dialogue.
Focus on ensuring the API never leaks stack traces or internal error details in responses.
Pay special attention to how the API handles unicode, emoji, and multi-byte characters.
