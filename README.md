# Midas Backend API Documentation

## Authentication

### Login
```typescript
POST /api/login
Body: { email: string, password: string }
Response: {
  message: string,
  user: {
    name: string,
    email: string,
    role: 'user' | 'admin'
  }
}
```

### Logout
```typescript
POST /api/logout
Response: { message: string }
```

### Get Profile
```typescript
GET /api/profile
Response: {
  name: string,
  email: string,
  company: string,
  role: string,
  admin_email: string | null
}
```

## User Operations

### Submit Reimbursement
```typescript
POST /api/request_reimbursement
Content-Type: multipart/form-data
Fields: {
  receipt: File, // .pdf, .docx, .jpg, .png, .zip allowed
  reimbursement_details: {
    type: string,
    amount: number,
    details?: string
  }
}
Response: {
  status: 'Approved' | 'Rejected' | 'Error',
  feedback: string,
  uploaded_files: string[],
  processed_files: number
}
```

### Get User's Reimbursements
```typescript
GET /api/users_reimbursements
Response: Array<{
  id: string,
  amount: number,
  description: string,
  status: string,
  date: Date,
  category: string
}>
```

## Admin Operations

### Upload Policy File
```typescript
POST /api/admin/upload_policy
Content-Type: multipart/form-data
Fields: {
  files: File[] // .txt, .pdf, .docx allowed
}
Response: { message: string }
```

### Create Manual Policy
```typescript
POST /api/admin/manual_policy
Body: {
  category: string,    // e.g., "travel", "meals"
  amount: number,      // Maximum amount allowed
  times: number,       // Number of claims allowed
  period: 'day' | 'week' | 'month' | 'year'  // Time period for limit
}
Response: { message: string }
```

### Generate Group Code
```typescript
POST /api/admin/generate-code
Response: {
  code: string,
  message: string
}
```

### Get Admin Users
```typescript
GET /api/admin/users
Response: {
  users: Array<{
    id: string,
    name: string,
    email: string,
    company: string,
    groups: string[],
    activeGroup: string,
    createdAt: Date
  }>
}
```

### Get Admin Reimbursements
```typescript
GET /api/admin/reimbursements
Response: {
  reimbursements: Array<{
    userEmail: string,
    adminEmail: string,
    reimbursementDetails: string,
    amount: number,
    category: string,
    status: string,
    feedback: string,
    createdAt: Date,
    s3Urls: string[]
  }>
}
```

## Group Management

### Join Group
```typescript
POST /api/join_group
Body: { group_code: string }
Response: { message: string }
```

### Switch Active Group
```typescript
POST /api/switch_active_group
Body: { groupId: string }
Response: { message: string }
```

### Get User's Groups
```typescript
GET /api/groups
Response: Array<{
  id: string,
  name: string,
  company: string,
  adminEmail: string,
  inviteCode: string,
  isPrivate: boolean,
  lastActive: Date,
  memberCount: number,
  isActive: boolean
}>
```

## Policy System

### Default Policy
If no custom policies exist, the system uses these defaults:
- Categories: travel, meals, office supplies, training
- Limits:
  - Meals: $50/day
  - Travel: $500/flight
  - Office Supplies: $200/item
- Must submit within 30 days
- Valid receipt required

### Custom Policies
Admins can set policies via:
1. File upload (.txt, .pdf, .docx)
2. Manual creation with specific limits
- Policies are stored per admin
- Latest policy is active by default
- Multiple policies can coexist if manually set active

## Limitations
- Max file size: 5MB
- Daily request limit: 10 per user
- Supported files: .docx, .pdf, .jpg, .png, .zip, .txt
- Custom policies override defaults when present