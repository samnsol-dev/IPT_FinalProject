<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];

$path = $_GET['resource'] ?? '';

if ($path === 'projects') {

    if ($method === 'GET') {
        $username = trim($_GET['user'] ?? '');
        $search   = trim($_GET['search'] ?? '');

        if ($search != '') {
            $search_user = trim($_GET['user'] ?? '');
            if ($search_user != '') {
                $stmt = $pdo->prepare(
                    'SELECT p.*,
                        CASE WHEN p.created_by = ? THEN 1
                             WHEN m.status = ? THEN 1
                             ELSE 0 END AS is_member,
                        CASE WHEN m.status = ? THEN 1 ELSE 0 END AS is_pending,
                        CASE WHEN p.created_by = ?
                             THEN (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = ?)
                             ELSE 0 END AS pending_requests
                     FROM projects p
                     LEFT JOIN project_members m ON m.project_id = p.id AND m.username = ?
                     WHERE p.name LIKE ?
                     ORDER BY p.created_at DESC'
                );
                $stmt->execute([$search_user, 'accepted', 'pending', $search_user, 'pending', $search_user, '%' . $search . '%']);
            } else {
                $stmt = $pdo->prepare('SELECT *, 0 AS is_member, 0 AS is_pending FROM projects WHERE name LIKE ? AND visibility = ? ORDER BY created_at DESC');
                $stmt->execute(['%' . $search . '%', 'public']);
            }
        } else if ($username != '') {
            // Sidebar
            $stmt = $pdo->prepare(
                'SELECT * FROM (
                    SELECT p.*, 1 AS is_member, 0 AS is_pending,
                        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.status = ?) AS pending_requests
                     FROM projects p WHERE p.created_by = ?
                     UNION
                     SELECT p.*, 1 AS is_member, 0 AS is_pending,
                        0 AS pending_requests
                     FROM projects p
                     JOIN project_members m ON m.project_id = p.id
                     WHERE m.username = ? AND p.created_by != ? AND m.status = ?
                     UNION
                     SELECT p.*, 0 AS is_member, 1 AS is_pending,
                        0 AS pending_requests
                     FROM projects p
                     JOIN project_members m ON m.project_id = p.id
                     WHERE m.username = ? AND p.created_by != ? AND m.status = ?
                 ) AS combined
                 ORDER BY created_at DESC'
            );
            $stmt->execute(['pending', $username, $username, $username, 'accepted', $username, $username, 'pending']);
        } else {
            $stmt = $pdo->query('SELECT *, 0 AS is_member FROM projects ORDER BY created_at DESC');
        }

        sendSuccess($stmt->fetchAll(PDO::FETCH_ASSOC), 'Projects fetched.');
    }

    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        if (json_last_error() !== JSON_ERROR_NONE) sendError('Invalid JSON body.');

        $action = trim($body['action'] ?? '');

        if ($action === 'request_join') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $username   = trim($body['username'] ?? '');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($username == '') sendError('Username is required.');

            $check = $pdo->prepare('SELECT id, created_by, visibility FROM projects WHERE id = ?');
            $check->execute([$project_id]);
            $project = $check->fetch(PDO::FETCH_ASSOC);
            if (!$project) sendError('Project not found.', 404);
            if ($project['created_by'] === $username) sendError('You cannot request to join your own project.');

            $already = $pdo->prepare('SELECT id, status FROM project_members WHERE project_id = ? AND username = ?');
            $already->execute([$project_id, $username]);
            $existing = $already->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                if ($existing['status'] === 'accepted') sendError('You are already a member of this project.');
                sendSuccess(null, 'Join request already pending.');
            }

            // Public projects: auto-approve
            $joinStatus = ($project['visibility'] === 'public') ? 'accepted' : 'pending';
            $pdo->prepare('INSERT INTO project_members (project_id, username, status) VALUES (?, ?, ?)')->execute([$project_id, $username, $joinStatus]);

            if ($joinStatus === 'accepted') {
                sendSuccess(['auto_approved' => true], 'Joined project successfully!');
            }
            sendSuccess(null, 'Join request sent!');
        }

        if ($action === 'cancel_join') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $username   = trim($body['username'] ?? '');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($username == '') sendError('Username is required.');

            $row = $pdo->prepare('SELECT id FROM project_members WHERE project_id = ? AND username = ? AND status = ?');
            $row->execute([$project_id, $username, 'pending']);
            if (!$row->fetch(PDO::FETCH_ASSOC)) sendError('No pending request found.');

            $pdo->prepare('DELETE FROM project_members WHERE project_id = ? AND username = ? AND status = ?')
                ->execute([$project_id, $username, 'pending']);

            sendSuccess(null, 'Join request cancelled.');
        }

        if ($action === 'respond_join') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $username   = trim($body['username'] ?? '');
            $owner      = trim($body['owner']    ?? '');
            $accept     = (bool)($body['accept'] ?? false);

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($username == '') sendError('Username is required.');
            if ($owner == '')    sendError('Owner is required.');

            $check = $pdo->prepare('SELECT id FROM projects WHERE id = ? AND created_by = ?');
            $check->execute([$project_id, $owner]);
            if (!$check->fetch(PDO::FETCH_ASSOC)) sendError('Project not found or you are not the owner.', 403);

            $row = $pdo->prepare('SELECT id FROM project_members WHERE project_id = ? AND username = ? AND status = ?');
            $row->execute([$project_id, $username, 'pending']);
            if (!$row->fetch(PDO::FETCH_ASSOC)) sendError('No pending request found.');

            if ($accept) {
                $pdo->prepare('UPDATE project_members SET status = ? WHERE project_id = ? AND username = ?')->execute(['accepted', $project_id, $username]);
                sendSuccess(null, 'Request accepted.');
            } else {
                $pdo->prepare('DELETE FROM project_members WHERE project_id = ? AND username = ?')->execute([$project_id, $username]);
                sendSuccess(null, 'Request declined.');
            }
        }

        if ($action === 'get_requests') {
            $owner      = trim($body['owner'] ?? '');
            $filter_pid = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            if ($owner == '') sendError('Owner is required.');

            if ($filter_pid && $filter_pid > 0) {
                $stmt = $pdo->prepare(
                    'SELECT m.id, m.project_id, m.username, m.status, p.name AS project_name
                     FROM project_members m
                     JOIN projects p ON p.id = m.project_id
                     WHERE p.created_by = ? AND m.project_id = ? AND m.status = ?
                     ORDER BY m.id DESC'
                );
                $stmt->execute([$owner, $filter_pid, 'pending']);
            } else {
                $stmt = $pdo->prepare(
                    'SELECT m.id, m.project_id, m.username, m.status, p.name AS project_name
                     FROM project_members m
                     JOIN projects p ON p.id = m.project_id
                     WHERE p.created_by = ? AND m.status = ?
                     ORDER BY m.id DESC'
                );
                $stmt->execute([$owner, 'pending']);
            }
            sendSuccess($stmt->fetchAll(PDO::FETCH_ASSOC), 'Requests fetched.');
        }

        if ($action === 'update_description') {
            $project_id  = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $owner       = trim($body['owner'] ?? '');
            $description = trim($body['description'] ?? '');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($owner == '') sendError('Owner is required.');

            $check = $pdo->prepare('SELECT id FROM projects WHERE id = ? AND created_by = ?');
            $check->execute([$project_id, $owner]);
            if (!$check->fetch(PDO::FETCH_ASSOC)) sendError('Project not found or you are not the owner.', 403);

            $pdo->prepare('UPDATE projects SET description = ? WHERE id = ?')->execute([cleanInput($description), $project_id]);
            sendSuccess(null, 'Description updated.');
        }

        if ($action === 'set_visibility') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $owner      = trim($body['owner'] ?? '');
            $visibility = trim($body['visibility'] ?? 'public');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($owner == '') sendError('Owner is required.');
            if (!in_array($visibility, ['public', 'private'])) sendError('Invalid visibility value.');

            $check = $pdo->prepare('SELECT id FROM projects WHERE id = ? AND created_by = ?');
            $check->execute([$project_id, $owner]);
            if (!$check->fetch(PDO::FETCH_ASSOC)) sendError('Project not found or you are not the owner.', 403);

            $pdo->prepare('UPDATE projects SET visibility = ? WHERE id = ?')->execute([$visibility, $project_id]);
            sendSuccess(['visibility' => $visibility], 'Visibility updated.');
        }

        if ($action === 'get_project_details') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $requester  = trim($body['username'] ?? '');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');

                    $pstmt = $pdo->prepare('SELECT * FROM projects WHERE id = ?');
            $pstmt->execute([$project_id]);
            $project = $pstmt->fetch(PDO::FETCH_ASSOC);
            if (!$project) sendError('Project not found.', 404);

            // Resolve requester's role
            $approval_status = 'none';
            if ($requester !== '' && $project['created_by'] === $requester) {
                $approval_status = 'owner';
            } elseif ($requester !== '') {
                $astmt = $pdo->prepare('SELECT status FROM project_members WHERE project_id = ? AND username = ?');
                $astmt->execute([$project_id, $requester]);
                $row = $astmt->fetch(PDO::FETCH_ASSOC);
                if ($row) $approval_status = $row['status'];
            }

            // All users can view project details
            $visibility = $project['visibility'] ?? 'public';

            // Fetch members
            $mstmt = $pdo->prepare('SELECT username FROM project_members WHERE project_id = ? AND status = ? ORDER BY id ASC');
            $mstmt->execute([$project_id, 'accepted']);
            $members = array_column($mstmt->fetchAll(PDO::FETCH_ASSOC), 'username');

            $pcstmt = $pdo->prepare('SELECT COUNT(*) FROM project_members WHERE project_id = ? AND status = ?');
            $pcstmt->execute([$project_id, 'pending']);
            $pending_count = (int) $pcstmt->fetchColumn();

            sendSuccess([
                'id'              => $project['id'],
                'name'            => $project['name'],
                'description'     => $project['description'] ?? '',
                'created_by'      => $project['created_by'],
                'created_at'      => $project['created_at'],
                'visibility'      => $visibility,
                'members'         => $members,
                'approval_status' => $approval_status,
                'pending_count'   => $pending_count,
            ], 'Project details fetched.');
        }

        if ($action === 'leave') {
            $project_id = filter_var($body['project_id'] ?? null, FILTER_VALIDATE_INT);
            $username   = trim($body['username'] ?? '');

            if (!$project_id || $project_id <= 0) sendError('Valid project ID is required.');
            if ($username == '') sendError('Username is required.');

            $check = $pdo->prepare('SELECT id, created_by FROM projects WHERE id = ?');
            $check->execute([$project_id]);
            $project = $check->fetch(PDO::FETCH_ASSOC);
            if (!$project) sendError('Project not found.', 404);
            if ($project['created_by'] === $username) sendError('Project owner cannot leave their own project.');

            $pdo->prepare('DELETE FROM project_members WHERE project_id = ? AND username = ?')->execute([$project_id, $username]);

            sendSuccess(null, 'Left project.');
        }

        $name       = trim($body['name']       ?? '');
        $created_by = trim($body['created_by'] ?? '');

        if ($name == '')            sendError('Project name is required.');
        if (strlen($name) > 150)   sendError('Project name must be 150 characters or fewer.');
        if ($created_by == '')     sendError('Created by is required.');

        $check = $pdo->prepare('SELECT id FROM projects WHERE name = ?');
        $check->execute([$name]);
        if ($check->fetch(PDO::FETCH_ASSOC)) sendError('A project with that name already exists.');

        $description = trim($body['description'] ?? '');
        $visibility  = trim($body['visibility']  ?? 'public');
        if (!in_array($visibility, ['public', 'private'])) $visibility = 'public';

        $stmt = $pdo->prepare('INSERT INTO projects (name, description, created_by, visibility) VALUES (?, ?, ?, ?)');
        $stmt->execute([cleanInput($name), cleanInput($description), cleanInput($created_by), $visibility]);

        $new_id = (int) $pdo->lastInsertId();
        $stmt   = $pdo->prepare('SELECT * FROM projects WHERE id = ?');
        $stmt->execute([$new_id]);
        sendSuccess($stmt->fetch(PDO::FETCH_ASSOC), 'Project created!', 201);
    }

    if ($method === 'DELETE') {
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id || $id <= 0) sendError('Valid project ID is required.');

        $check = $pdo->prepare('SELECT id FROM projects WHERE id = ?');
        $check->execute([$id]);
        if (!$check->fetch(PDO::FETCH_ASSOC)) sendError('Project not found.', 404);

        $pdo->prepare('DELETE FROM project_members WHERE project_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM projects WHERE id = ?')->execute([$id]);
        sendSuccess(null, 'Project deleted!');
    }

    sendError('Method not allowed.', 405);
}

$allowed_statuses   = ['pending', 'in_progress', 'completed'];
$allowed_priorities = ['low', 'medium', 'high'];

function sendSuccess($data, $message = 'Success', $code = 200) {
    http_response_code($code);
    echo json_encode([
        'success' => true,
        'message' => $message,
        'data'    => $data
    ]);
    exit;
}

function sendError($message, $code = 400) {
    http_response_code($code);
    echo json_encode([
        'success' => false,
        'message' => $message,
        'data'    => null
    ]);
    exit;
}

function cleanInput($value) {
    return trim($value);
}

function formatAssignedTo($input) {
    if (is_array($input)) {
        $names = array_filter(array_map('trim', $input));
        if (empty($names)) {
            return 'Everyone';
        }
        return implode(',', $names);
    }
    $text = trim((string) $input);
    if ($text == '') {
        return 'Everyone';
    }
    return $text;
}

function validateInt($val) {
    $id = filter_var($val, FILTER_VALIDATE_INT);
    return ($id && $id > 0) ? $id : null;
}

function requireField($val, $name) {
    if (trim($val ?? '') === '') sendError($name . ' is required.');
    return trim($val);
}

function convertTask($task) {
    $task['assigned_to']       = array_map('trim', explode(',', $task['assigned_to']));
    $task['status_changed_by'] = $task['status_changed_by'] ?? null;
    $task['status_changed_at'] = $task['status_changed_at'] ?? null;
    return $task;
}

// GET - fetch tasks
if ($method === 'GET') {

    if (!empty($_GET['id'])) {
        $id = filter_var($_GET['id'], FILTER_VALIDATE_INT);
        if (!$id || $id <= 0) {
            sendError('Invalid task ID.');
        }

        $stmt = $pdo->prepare('SELECT * FROM tasks WHERE id = ?');
        $stmt->execute([$id]);
        $task = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$task) {
            sendError('Task not found.', 404);
        }

        sendSuccess(convertTask($task), 'Task fetched.');
    }

    $status = $_GET['status'] ?? '';

    if ($status != '' && !in_array($status, $allowed_statuses)) {
        sendError('Invalid status filter.');
    }

    $project_id = filter_var($_GET['project_id'] ?? '', FILTER_VALIDATE_INT);

    $current_user = trim($_GET['user'] ?? '');
    $is_overview  = !empty($_GET['overview']);

    if ($status != '' && $project_id) {
        $stmt = $pdo->prepare('SELECT * FROM tasks WHERE status = ? AND project_id = ? ORDER BY created_at DESC');
        $stmt->execute([$status, $project_id]);

    } else if ($project_id) {
        $stmt = $pdo->prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC');
        $stmt->execute([$project_id]);

    } else if ($current_user != '' && $is_overview) {
        // "My Tasks" overview
        $like_user_start = $current_user . ',%';
        $like_user_mid   = '%,' . $current_user . ',%';
        $like_user_end   = '%,' . $current_user;

        // Tasks involving user directly
        $involved = '(
            posted_by = :u1
            OR assigned_to = :u2
            OR assigned_to LIKE :u3
            OR assigned_to LIKE :u4
            OR assigned_to LIKE :u5
        )';

        // User must be project member
        $in_project = '(
            project_id IS NULL
            OR EXISTS (
                SELECT 1 FROM projects p
                WHERE p.id = tasks.project_id AND p.created_by = :u6
            )
            OR EXISTS (
                SELECT 1 FROM project_members pm
                WHERE pm.project_id = tasks.project_id AND pm.username = :u7 AND pm.status = \'accepted\'
            )
        )';

        $everyone_in_project = '(
            LOWER(assigned_to) = \'everyone\'
            AND project_id IS NOT NULL
            AND (
                EXISTS (
                    SELECT 1 FROM projects p
                    WHERE p.id = tasks.project_id AND p.created_by = :u8
                )
                OR EXISTS (
                    SELECT 1 FROM project_members pm
                    WHERE pm.project_id = tasks.project_id AND pm.username = :u9 AND pm.status = \'accepted\'
                )
            )
        )';

        $where = "($involved AND $in_project) OR $everyone_in_project";

        if ($status != '') {
            $stmt = $pdo->prepare(
                "SELECT * FROM tasks
                 WHERE status = :status AND ($where)
                 ORDER BY created_at DESC"
            );
            $stmt->execute([
                ':status' => $status,
                ':u1' => $current_user, ':u2' => $current_user,
                ':u3' => $like_user_start, ':u4' => $like_user_mid, ':u5' => $like_user_end,
                ':u6' => $current_user, ':u7' => $current_user,
                ':u8' => $current_user, ':u9' => $current_user,
            ]);
        } else {
            $stmt = $pdo->prepare(
                "SELECT * FROM tasks
                 WHERE $where
                 ORDER BY created_at DESC"
            );
            $stmt->execute([
                ':u1' => $current_user, ':u2' => $current_user,
                ':u3' => $like_user_start, ':u4' => $like_user_mid, ':u5' => $like_user_end,
                ':u6' => $current_user, ':u7' => $current_user,
                ':u8' => $current_user, ':u9' => $current_user,
            ]);
        }

    } else if ($status != '') {
        $stmt = $pdo->prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC');
        $stmt->execute([$status]);
    } else {
        $stmt = $pdo->query('SELECT * FROM tasks ORDER BY created_at DESC');
    }

    $all_tasks = array_map('convertTask', $stmt->fetchAll(PDO::FETCH_ASSOC));
    sendSuccess($all_tasks, 'Tasks fetched.');
}

// POST - login, register, or add task
if ($method === 'POST') {

    $body = json_decode(file_get_contents('php://input'), true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        sendError('Invalid JSON body.');
    }

    $action = trim($body['action'] ?? '');

    if ($action === 'register') {
        $username = trim($body['username'] ?? '');
        $password = trim($body['password'] ?? '');

        if ($username == '') sendError('Username is required.');
        if ($password == '') sendError('Password is required.');

        $check = $pdo->prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
        $check->execute([$username]);
        if ($check->fetch(PDO::FETCH_ASSOC)) {
            sendError('Username already taken.');
        }

        $stmt = $pdo->prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);

        sendSuccess(['id' => (int) $pdo->lastInsertId()], 'Account created!', 201);
    }

    if ($action === 'login') {
        $username = trim($body['username'] ?? '');
        $password = trim($body['password'] ?? '');

        if ($username == '') sendError('Username is required.');
        if ($password == '') sendError('Password is required.');

        $stmt = $pdo->prepare('SELECT id, username, password FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || !password_verify($password, $user['password'])) {
            sendError('Invalid username or password.', 401);
        }

        sendSuccess(['id' => $user['id'], 'username' => $user['username']], 'Login successful!');
    }

    $title = trim($body['title'] ?? '');
    if ($title == '')          sendError('Title is required.');
    if (strlen($title) > 150)  sendError('Title must be 150 characters or fewer.');

    $posted_by = trim($body['posted_by'] ?? '');
    if ($posted_by == '') sendError('Posted by is required.');

    $status   = $body['status']   ?? 'pending';
    $priority = $body['priority'] ?? 'medium';

    if (!in_array($status,   $allowed_statuses))   sendError('Invalid status value.');
    if (!in_array($priority, $allowed_priorities)) sendError('Invalid priority value.');

    $due_date = null;
    if (!empty($body['due_date'])) {
        $date_check = DateTime::createFromFormat('Y-m-d', $body['due_date']);
        if (!$date_check || $date_check->format('Y-m-d') !== $body['due_date']) {
            sendError('Invalid due_date — expected YYYY-MM-DD.');
        }
        $due_date = $body['due_date'];
    }

    $category_id = null;
    if (!empty($body['category_id'])) {
        $cat_id = filter_var($body['category_id'], FILTER_VALIDATE_INT);
        if ($cat_id && $cat_id > 0) {
            $category_id = $cat_id;
        }
    }

    $assigned_to = formatAssignedTo($body['assigned_to'] ?? 'Everyone');

    $task_project_id = null;
    if (!empty($body['project_id'])) {
        $p = filter_var($body['project_id'], FILTER_VALIDATE_INT);
        if ($p && $p > 0) {
            $pcheck = $pdo->prepare('SELECT id FROM projects WHERE id = ?');
            $pcheck->execute([$p]);
            if (!$pcheck->fetch(PDO::FETCH_ASSOC)) sendError('Project not found.');
            $task_project_id = $p;
        }
    }

    if ($task_project_id === null) sendError('Tasks must belong to a project.');

    // Reject duplicate task title in project
    $dupCheck = $pdo->prepare('SELECT id FROM tasks WHERE LOWER(title) = LOWER(?) AND project_id = ?');
    $dupCheck->execute([cleanInput($title), $task_project_id]);
    if ($dupCheck->fetch(PDO::FETCH_ASSOC)) sendError('A task with that title already exists.');

    $stmt = $pdo->prepare(
        'INSERT INTO tasks (project_id, category_id, title, description, status, priority, due_date, posted_by, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $task_project_id,
        $category_id,
        cleanInput($title),
        cleanInput($body['description'] ?? ''),
        $status,
        $priority,
        $due_date,
        cleanInput($posted_by),
        cleanInput($assigned_to),
    ]);

    $new_id = (int) $pdo->lastInsertId();
    $stmt   = $pdo->prepare('SELECT * FROM tasks WHERE id = ?');
    $stmt->execute([$new_id]);

    sendSuccess(convertTask($stmt->fetch(PDO::FETCH_ASSOC)), 'Task created!', 201);
}

// PUT - update task
if ($method === 'PUT') {

    $body = json_decode(file_get_contents('php://input'), true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        sendError('Invalid JSON body.');
    }

    $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id || $id <= 0) sendError('Valid task ID is required.');

    $check = $pdo->prepare('SELECT id, posted_by FROM tasks WHERE id = ?');
    $check->execute([$id]);
    $existing_task = $check->fetch(PDO::FETCH_ASSOC);
    if (!$existing_task) sendError('Task not found.', 404);

    $title = trim($body['title'] ?? '');
    if ($title == '')         sendError('Title is required.');
    if (strlen($title) > 150) sendError('Title must be 150 characters or fewer.');

    $posted_by = trim($body['posted_by'] ?? '');
    if ($posted_by == '') sendError('Posted by is required.');

    // Owner: full edit
    $is_owner = strtolower($posted_by) === strtolower($existing_task['posted_by']);
    $changed_by_field = trim($body['changed_by'] ?? '');
    $is_status_only = ($changed_by_field !== '' && $posted_by !== $existing_task['posted_by']);
    if (!$is_owner && !$is_status_only) {
        sendError('You are not authorized to edit this task.', 403);
    }

    $status   = $body['status']   ?? 'pending';
    $priority = $body['priority'] ?? 'medium';

    if (!in_array($status,   $allowed_statuses))   sendError('Invalid status value.');
    if (!in_array($priority, $allowed_priorities)) sendError('Invalid priority value.');

    $due_date = null;
    if (!empty($body['due_date'])) {
        $date_check = DateTime::createFromFormat('Y-m-d', $body['due_date']);
        if (!$date_check || $date_check->format('Y-m-d') !== $body['due_date']) {
            sendError('Invalid due_date — expected YYYY-MM-DD.');
        }
        $due_date = $body['due_date'];
    }

    $category_id = null;
    if (!empty($body['category_id'])) {
        $cat_id = filter_var($body['category_id'], FILTER_VALIDATE_INT);
        if ($cat_id && $cat_id > 0) {
            $category_id = $cat_id;
        }
    }

    $assigned_to = formatAssignedTo($body['assigned_to'] ?? 'Everyone');

    $task_project_id = null;
    if (!empty($body['project_id'])) {
        $p = filter_var($body['project_id'], FILTER_VALIDATE_INT);
        if ($p && $p > 0) {
            $pcheck = $pdo->prepare('SELECT id FROM projects WHERE id = ?');
            $pcheck->execute([$p]);
            if (!$pcheck->fetch(PDO::FETCH_ASSOC)) sendError('Project not found.');
            $task_project_id = $p;
        }
    }

    if ($task_project_id !== null) {
        $dupCheck = $pdo->prepare('SELECT id FROM tasks WHERE LOWER(title) = LOWER(?) AND project_id = ? AND id != ?');
        $dupCheck->execute([cleanInput($title), $task_project_id, $id]);
    } else {
        $dupCheck = $pdo->prepare('SELECT id FROM tasks WHERE LOWER(title) = LOWER(?) AND project_id IS NULL AND id != ?');
        $dupCheck->execute([cleanInput($title), $id]);
    }
    if ($dupCheck->fetch(PDO::FETCH_ASSOC)) sendError('A task with that title already exists.');

    try {
        $pdo->exec("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status_changed_by TEXT NULL");
        $pdo->exec("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status_changed_at DATETIME NULL");
    } catch (PDOException $e) { /* MySQL < 8 doesn't support IF NOT EXISTS on columns — ignore */ }

    // Get current status + tracking
    $prevRow    = [];
    $prevStatus = '';
    $prev = $pdo->prepare('SELECT status, status_changed_by, status_changed_at FROM tasks WHERE id = ?');
    $prev->execute([$id]);
    $prevRow    = $prev->fetch(PDO::FETCH_ASSOC) ?: [];
    $prevStatus = $prevRow['status'] ?? '';

    $changed_by = trim($body['changed_by'] ?? '');

    // "everyone" → specific person drops all other workers
    $new_assigned_lower = strtolower(trim($assigned_to));
    if ($new_assigned_lower !== 'everyone') {
        $new_assignees        = array_map('strtolower', array_map('trim', explode(',', $assigned_to)));
        $existing_workers_raw = trim($prevRow['status_changed_by'] ?? '');
        if ($existing_workers_raw !== '') {
            $workers = array_values(array_filter(array_map('trim', explode(',', $existing_workers_raw))));
            $workers = array_values(array_filter($workers, function($w) use ($new_assignees) {
                return in_array(strtolower(trim($w)), $new_assignees);
            }));
            $prevRow['status_changed_by'] = count($workers) > 0 ? implode(', ', $workers) : null;
        }
    }

    if ($status === 'in_progress' && $changed_by !== '') {
        // Accumulate workers
        $existing_raw = trim($prevRow['status_changed_by'] ?? '');
        $existing     = $existing_raw !== ''
            ? array_values(array_filter(array_map('trim', explode(',', $existing_raw))))
            : [];
        $existing_lower = array_map('strtolower', $existing);
        $new_name       = trim($changed_by);
        if ($new_name !== '' && !in_array(strtolower($new_name), $existing_lower)) {
            $existing[] = $new_name;
        }
        $new_status_changed_by = implode(', ', $existing);
        $new_status_changed_at = !empty($prevRow['status_changed_at'])
            ? $prevRow['status_changed_at']
            : date('Y-m-d H:i:s');
    } elseif ($status === 'pending' && $changed_by !== '') {
        // Reverting to pending
        $existing_raw = trim($prevRow['status_changed_by'] ?? '');
        $existing     = $existing_raw !== ''
            ? array_values(array_filter(array_map('trim', explode(',', $existing_raw))))
            : [];
        $existing = array_values(array_filter($existing, function($name) use ($changed_by) {
            return strtolower(trim($name)) !== strtolower(trim($changed_by));
        }));
        $new_status_changed_by = count($existing) > 0 ? implode(', ', $existing) : null;
        $new_status_changed_at = $prevRow['status_changed_at'] ?? null;
    } elseif ($status === 'completed' && $changed_by !== '') {
        // Completed
        $new_status_changed_by = trim($changed_by);
        $new_status_changed_at = date('Y-m-d H:i:s');
    } else {
        // No changed_by or unhandled
        $new_status_changed_by = $prevRow['status_changed_by'] ?? null;
        $new_status_changed_at = $prevRow['status_changed_at'] ?? null;
    }

    $stmt = $pdo->prepare(
        'UPDATE tasks SET project_id=?, category_id=?, title=?, description=?, status=?, priority=?, due_date=?, posted_by=?, assigned_to=?, status_changed_by=?, status_changed_at=?
         WHERE id=?'
    );
    $stmt->execute([
        $task_project_id,
        $category_id,
        cleanInput($title),
        cleanInput($body['description'] ?? ''),
        $status,
        $priority,
        $due_date,
        cleanInput($posted_by),
        cleanInput($assigned_to),
        $new_status_changed_by,
        $new_status_changed_at,
        $id,
    ]);

    $stmt = $pdo->prepare('SELECT * FROM tasks WHERE id = ?');
    $stmt->execute([$id]);

    sendSuccess(convertTask($stmt->fetch(PDO::FETCH_ASSOC)), 'Task updated!');
}

// DELETE - delete task
if ($method === 'DELETE') {
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id || $id <= 0) sendError('Valid task ID is required.');

    $requesting_user = trim($_GET['user'] ?? '');
    if ($requesting_user === '') sendError('Unauthorized.', 403);

    $check = $pdo->prepare('SELECT id, posted_by FROM tasks WHERE id = ?');
    $check->execute([$id]);
    $task_row = $check->fetch(PDO::FETCH_ASSOC);
    if (!$task_row) sendError('Task not found.', 404);

    if (strtolower($requesting_user) !== strtolower($task_row['posted_by'])) {
        sendError('You are not authorized to delete this task.', 403);
    }

    $pdo->prepare('DELETE FROM tasks WHERE id = ?')->execute([$id]);
    sendSuccess(null, 'Task deleted!');
}

sendError('Method not allowed.', 405);