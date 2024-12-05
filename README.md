# API Documentation for Front-End Engineer

This documentation provides detailed information about all the API endpoints available in the application. It includes the request and response formats, parameters, and expected outputs for each endpoint. This will help you integrate the front-end application with the back-end services effectively.

---

## Table of Contents

1. [Authentication Endpoints](#1-authentication-endpoints)
   - [Register User](#register-user)
   - [Login User](#login-user)
   - [Logout User](#logout-user)
2. [User Endpoints](#2-user-endpoints)
   - [Get User Profile](#get-user-profile)
   - [Get User's Groups](#get-users-groups)
   - [Switch Active Group](#switch-active-group)
   - [Get User's Policies](#get-users-policies)
   - [Get User's Reimbursement Requests](#get-users-reimbursement-requests)
   - [Get User's Request Limits](#get-users-request-limits)
3. [Admin Endpoints](#3-admin-endpoints)
   - [Generate Invite Code](#generate-invite-code)
   - [Set Policy for User](#set-policy-for-user)
   - [Get Admin Info](#get-admin-info)
   - [Get Admin Members](#get-admin-members)
   - [View Reimbursement Requests](#view-reimbursement-requests)
4. [Group Endpoints](#4-group-endpoints)
   - [Join Group](#join-group)
5. [Reimbursement Endpoints](#5-reimbursement-endpoints)
   - [Request Reimbursement](#request-reimbursement)
6. [Error Handling](#6-error-handling)

---

## 1. Authentication Endpoints

### Register User

**Endpoint:**

```
POST /api/register
```

**Description:**

Registers a new user (admin or regular user) to the application.

**Request Headers:**

- `Content-Type: application/json`

**Request Body (JSON):**

For Admin User:

```json
{
  "name": "Alice Admin",
  "company": "TestCorp",
  "email": "alice.admin@testcorp.com",
  "password": "Password123!",
  "confirmPassword": "Password123!",
  "isAdmin": true
}
```

For Regular User:

```json
{
  "name": "Bob User",
  "company": "TestCorp",
  "email": "bob.user@testcorp.com",
  "password": "Password123!",
  "confirmPassword": "Password123!",
  "isAdmin": false
}
```

**Response (JSON):**

Success:

```json
{
  "message": "User registered successfully"
}
```

Error:

```json
{
  "message": "Error message detailing what went wrong"
}
```

---

### Login User

**Endpoint:**

```
POST /api/login
```

**Description:**

Logs in a user and establishes a session.

**Request Headers:**

- `Content-Type: application/json`

**Request Body (JSON):**

```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**Response (JSON):**

Success:

```json
{
  "message": "Login successful",
  "user": {
    "name": "User Name",
    "email": "user@example.com",
    "company": "Company Name",
    "role": "admin" | "user"
  }
}
```

Error:

```json
{
  "message": "Invalid email or password"
}
```

---

### Logout User

**Endpoint:**

```
POST /api/logout
```

**Description:**

Logs out the currently authenticated user.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "message": "Logged out successfully"
}
```

---

## 2. User Endpoints

### Get User Profile

**Endpoint:**

```
GET /api/profile
```

**Description:**

Retrieves the profile information of the currently authenticated user.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "name": "User Name",
  "email": "user@example.com",
  "company": "Company Name",
  "role": "admin" | "user"
}
```

Error:

```json
{
  "message": "User not authenticated"
}
```

---

### Get User's Groups

**Endpoint:**

```
GET /api/groups
```

**Description:**

Retrieves all groups the user is a member of.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
[
  {
    "id": "groupId1",
    "name": "Group Name",
    "company": "Company Name",
    "adminEmail": "admin@example.com",
    "inviteCode": "INVITECODE123",
    "isPrivate": false,
    "lastActive": "2021-03-25T15:23:10.000Z",
    "memberCount": 10,
    "isActive": true
  },
  {
    "id": "groupId2",
    "name": "Another Group",
    "company": "Company Name",
    "adminEmail": "admin@example.com",
    "inviteCode": "ANOTHERINVITE",
    "isPrivate": false,
    "lastActive": "2021-03-20T10:00:00.000Z",
    "memberCount": 5,
    "isActive": false
  }
]
```

---

### Switch Active Group

**Endpoint:**

```
POST /api/switch_active_group
```

**Description:**

Switches the user's active group to the specified group.

**Request Headers:**

- `Content-Type: application/json`
- Cookie: Include session cookie received upon login.

**Request Body (JSON):**

```json
{
  "groupId": "groupId1"
}
```

**Response (JSON):**

Success:

```json
{
  "message": "Active group switched successfully"
}
```

Error:

```json
{
  "message": "Group not found or not a member of the group"
}
```

---

### Get User's Policies

**Endpoint:**

```
GET /api/user/policies
```

**Description:**

Retrieves the reimbursement policies for the user's active group.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "category": "Travel",
  "amount": 1000,
  "frequency": {
    "times": 5,
    "days": 30
  }
}
```

Error:

```json
{
  "message": "No active group found"
}
```

---

### Get User's Reimbursement Requests

**Endpoint:**

```
GET /api/users_reimbursements
```

**Description:**

Retrieves all reimbursement requests submitted by the user.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
[
  {
    "id": "requestId1",
    "amount": 45.0,
    "description": "Business lunch with client",
    "status": "approved",
    "date": "2021-03-25T15:23:10.000Z",
    "category": "Travel"
  },
  {
    "id": "requestId2",
    "amount": 150.0,
    "description": "Hotel stay during conference",
    "status": "rejected",
    "date": "2021-03-20T10:00:00.000Z",
    "category": "Travel"
  }
]
```

---

### Get User's Request Limits

**Endpoint:**

```
GET /api/user/request_limits
```

**Description:**

Retrieves the user's remaining reimbursement request limits based on the policy.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "remainingRequests": 3,
  "nextResetDate": "2021-04-24T15:23:10.000Z",
  "maxRequests": 5,
  "resetPeriodDays": 30
}
```

Error:

```json
{
  "message": "Error fetching request limits"
}
```

---

## 3. Admin Endpoints

### Generate Invite Code

**Endpoint:**

```
POST /api/admin/generate-code
```

**Description:**

Generates an invite code for the admin's company, allowing users to join the group.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "code": "INVITECODE123",
  "message": "Invite code generated successfully"
}
```

Error:

```json
{
  "message": "Error generating invite code"
}
```

---

### Set Policy for User

**Endpoint:**

```
POST /api/admin/set_policy
```

**Description:**

Sets or updates the reimbursement policy for a specific user in the admin's group.

**Request Headers:**

- Cookie: Include session cookie received upon login.
- `Content-Type: multipart/form-data`

**Request Body (Form Data):**

- `userEmail`: Email of the user to set the policy for.
- `policy`: Policy file uploaded (supports `.txt`, `.pdf`, `.docx`, `.zip` containing these files).

**Response (JSON):**

Success:

```json
{
  "message": "Policy updated successfully",
  "policy": {
    "category": "Travel",
    "amount": 1000,
    "frequency": {
      "times": 5,
      "days": 30
    }
  }
}
```

Error:

```json
{
  "message": "Error setting policy",
  "error": "Detailed error message"
}
```

---

### Get Admin Info

**Endpoint:**

```
GET /api/admin/info
```

**Description:**

Retrieves the admin's company information.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "company": "TestCorp"
}
```

---

### Get Admin Members

**Endpoint:**

```
GET /api/admin/members
```

**Description:**

Retrieves a list of members in the admin's group(s), along with their policies.

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "members": [
    {
      "name": "Bob User",
      "email": "bob.user@testcorp.com",
      "policies": [
        {
          "groupId": "groupId1",
          "policy": {
            "category": "Travel",
            "amount": 1000,
            "frequency": {
              "times": 5,
              "days": 30
            }
          }
        }
      ]
    },
    // Additional members...
  ]
}
```

---

### View Reimbursement Requests

**Endpoint:**

```
GET /api/admin/reimbursements
```

**Description:**

Retrieves all reimbursement requests submitted by users in the admin's group(s).

**Request Headers:**

- Cookie: Include session cookie received upon login.

**Response (JSON):**

Success:

```json
{
  "reimbursements": [
    {
      "userEmail": "bob.user@testcorp.com",
      "reimbursementDetails": "{\"description\":\"Business lunch with client\",\"amount\":45.00}",
      "amount": 45.0,
      "category": "Travel",
      "status": "Approved",
      "feedback": "Approved as per policy.",
      "createdAt": "2021-03-25T15:23:10.000Z",
      "s3Urls": ["https://..."],
      "groupId": "groupId1"
    },
    // Additional requests...
  ]
}
```

---

## 4. Group Endpoints

### Join Group

**Endpoint:**

```
POST /api/join_group
```

**Description:**

Allows a user to join a group using an invite code.

**Request Headers:**

- `Content-Type: application/json`
- Cookie: Include session cookie received upon login.

**Request Body (JSON):**

```json
{
  "group_code": "INVITECODE123"
}
```

**Response (JSON):**

Success:

```json
{
  "message": "Joined group successfully"
}
```

Error:

```json
{
  "message": "Invalid or expired invite code"
}
```

---

## 5. Reimbursement Endpoints

### Request Reimbursement

**Endpoint:**

```
POST /api/request_reimbursement
```

**Description:**

Submits a reimbursement request along with the receipt file.

**Request Headers:**

- Cookie: Include session cookie received upon login.
- `Content-Type: multipart/form-data`

**Request Body (Form Data):**

- `reimbursement_details`: JSON string containing details about the reimbursement.
  - Example: `{"description":"Business lunch with client","amount":45.00}`
- `receipt`: Receipt file uploaded (supports `.jpg`, `.jpeg`, `.png`, `.pdf`, `.docx`).

**Response (JSON):**

Success:

```json
{
  "status": "Approved" | "Rejected" | "Error",
  "feedback": "Explanation of the decision or error message",
  "uploaded_files": ["https://s3.amazonaws.com/..."], // URLs to uploaded files
  "processed_files": [ /* Details about processed files if any */ ]
}
```

Error:

```json
{
  "status": "Error",
  "feedback": "Detailed error message"
}
```

---

## 6. Error Handling

All endpoints return appropriate HTTP status codes and error messages when errors occur. Common error responses include:

- **401 Unauthorized:**

  ```json
  {
    "message": "User not authenticated."
  }
  ```

- **403 Forbidden:**

  ```json
  {
    "message": "Not authorized."
  }
  ```

- **400 Bad Request:**

  ```json
  {
    "message": "All fields are required."
  }
  ```

- **500 Internal Server Error:**

  ```json
  {
    "message": "Error message detailing what went wrong."
  }
  ```

---

## Additional Notes

- **Authentication:**

  - Most endpoints require the user to be authenticated.
  - Authentication is managed via session cookies. Ensure cookies are sent with each request that requires authentication.

- **Data Formats:**

  - All requests and responses are in JSON format unless otherwise specified (e.g., file uploads use `multipart/form-data`).

- **File Uploads:**

  - When uploading files, use `multipart/form-data` encoding.
  - Supported file types are specified for each endpoint.

- **Policy Details:**

  - Policies include categories, amount limits, and frequency limits.
  - Policies are associated with users per group.

- **Reimbursement Processing:**

  - Reimbursement requests are analyzed using AI to determine approval.
  - The response includes the decision, feedback, and any uploaded file URLs.

---

## Example Workflow

1. **User Registration and Login:**

   - User registers using `/api/register`.
   - User logs in using `/api/login`.
   - Session cookie is stored for subsequent requests.

2. **Admin Generates Invite Code:**

   - Admin generates an invite code using `/api/admin/generate-code`.

3. **User Joins Group:**

   - User joins the group using `/api/join_group` with the invite code.

4. **Admin Sets Policy:**

   - Admin sets a policy for the user using `/api/admin/set_policy`, uploading a policy file.

5. **User Requests Reimbursement:**

   - User submits a reimbursement request using `/api/request_reimbursement`, uploading a receipt file.

6. **Admin Reviews Requests:**

   - Admin views all reimbursement requests using `/api/admin/reimbursements`.

