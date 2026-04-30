var API = 'api.php';

if (!sessionStorage.getItem('user')) {
    window.location.href = 'login.html';
}

var currentUser = JSON.parse(sessionStorage.getItem('user'));

var modal;
var toast;
var logoutModal;

var currentFilter = '';
var assignMode = 'everyone';
var assignees = [];
var currentProjectId = '';
var projectModal;
var allProjects = [];
var _highlightTaskId = null;  // Task to highlight after project navigation

document.addEventListener('DOMContentLoaded', function() {

    modal       = new bootstrap.Modal(document.getElementById('taskModal'));
    toast       = new bootstrap.Toast(document.getElementById('liveToast'), { delay: 3000 });
    logoutModal = new bootstrap.Modal(document.getElementById('logoutModal'));
    projectModal = new bootstrap.Modal(document.getElementById('projectModal'));

    document.getElementById('taskModal').addEventListener('hide.bs.modal', function(e) {
        var title = document.getElementById('taskTitle').value.trim();
        var desc  = document.getElementById('taskDesc').value.trim();
        var id    = document.getElementById('taskId').value;
        var isDirty = title !== '' || desc !== '';
        // Edits always considered dirty
        if (!isDirty && !id) return;
        if (window._modalSavedOk) { window._modalSavedOk = false; return; }
        e.preventDefault();
        showConfirm({
            type:        'warning',
            icon:        'bi-exclamation-triangle-fill',
            title:       'Discard changes?',
            sub:         'Your unsaved changes will be lost.',
            okLabel:     'Discard',
            cancelLabel: 'Keep Editing',
        }).then(function(confirmed) {
            if (confirmed) {
                window._modalSavedOk = true;
                modal.hide();
            }
        });
    });

    document.getElementById('loggedInUser').textContent = currentUser.username;

    document.getElementById('btnConfirmLogout').addEventListener('click', function() {
        sessionStorage.removeItem('user');
        window.location.href = 'login.html';
    });

    // Add assignee
    document.getElementById('assigneeInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addAssigneeFromInput();
        }
    });

    (function initScrollbar() {
        var grid  = document.getElementById('taskGrid');
        var track = document.getElementById('taskGridTrack');
        var thumb = document.getElementById('taskGridThumb');
        if (!grid || !track || !thumb) return;

        function updateThumb() {
            var visibleRatio = grid.clientHeight / grid.scrollHeight;
            var thumbH = Math.max(24, track.clientHeight * visibleRatio);
            var scrollRatio = grid.scrollHeight <= grid.clientHeight
                ? 0
                : grid.scrollTop / (grid.scrollHeight - grid.clientHeight);
            var maxTop = track.clientHeight - thumbH;
            thumb.style.height = thumbH + 'px';
            thumb.style.top    = (scrollRatio * maxTop) + 'px';
            track.style.opacity = visibleRatio >= 1 ? '0.35' : '1';
        }

        grid.addEventListener('scroll', updateThumb);
        var ro = new ResizeObserver(updateThumb);
        ro.observe(grid);
        updateThumb();

        // Drag-to-scroll on the thumb
        var dragging = false, dragStartY = 0, dragStartScrollTop = 0;
        thumb.style.pointerEvents = 'auto';
        thumb.addEventListener('mousedown', function(e) {
            dragging = true;
            dragStartY = e.clientY;
            dragStartScrollTop = grid.scrollTop;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            var thumbH = parseFloat(thumb.style.height) || 24;
            var ratio = (grid.scrollHeight - grid.clientHeight) / (track.clientHeight - thumbH);
            grid.scrollTop = dragStartScrollTop + (e.clientY - dragStartY) * ratio;
        });
        document.addEventListener('mouseup', function() { dragging = false; });
    })();

    // Starred projects
    try {
        starredProjects = JSON.parse(localStorage.getItem('tf_starred') || '{}');
    } catch(e) { starredProjects = {}; }

    // Clickable row styles
    var _s = document.createElement('style');
    _s.textContent = '.clickable-row { cursor: pointer; } .clickable-row:hover { background: rgba(124,106,255,.07) !important; }';
    document.head.appendChild(_s);

    loadProjects().then(function() { loadTasks(); });
});

function toggleOverview() {
    var stats   = document.getElementById('overviewStats');
    var chevron = document.getElementById('overviewChevron');
    var collapsed = stats.classList.toggle('collapsed');
    chevron.classList.toggle('collapsed', collapsed);
    localStorage.setItem('overviewCollapsed', collapsed ? '1' : '0');
}

// Restore overview state
(function() {
    if (localStorage.getItem('overviewCollapsed') === '1') {
        var stats   = document.getElementById('overviewStats');
        var chevron = document.getElementById('overviewChevron');
        if (stats)   stats.classList.add('collapsed');
        if (chevron) chevron.classList.add('collapsed');
    }
})();

function logout() {
    logoutModal.show();
}

function showConfirm(opts) {
    return new Promise(function(resolve) {
        var type        = opts.type        || 'danger';
        var title       = opts.title       || 'Are you sure?';
        var sub         = opts.sub         || '';
        var warning     = opts.warning     || '';
        var okLabel     = opts.okLabel     || 'Confirm';
        var cancelLabel = opts.cancelLabel || 'Cancel';
        var icon        = opts.icon        || (type === 'danger' ? 'bi-trash3-fill' : 'bi-exclamation-triangle-fill');

        var modalEl   = document.getElementById('confirmModal');
        var iconEl    = document.getElementById('confirmIcon');
        var innerEl   = document.getElementById('confirmIconInner');
        var titleEl   = document.getElementById('confirmTitle');
        var subEl     = document.getElementById('confirmSub');
        var warnEl    = document.getElementById('confirmWarning');
        var okBtn     = document.getElementById('btnConfirmOk');
        var cancelBtn = document.getElementById('btnConfirmCancel');

        // Populate
        iconEl.className      = 'confirm-modal-icon ' + type;
        innerEl.className     = 'bi ' + icon;
        titleEl.textContent   = title;
        subEl.innerHTML       = sub;
        okBtn.textContent     = okLabel;
        okBtn.className       = 'btn-confirm-ok ' + type;
        cancelBtn.textContent = cancelLabel;

        if (warning) {
            warnEl.innerHTML     = '<i class="bi bi-exclamation-circle-fill"></i> ' + warning;
            warnEl.style.display = '';
        } else {
            warnEl.style.display = 'none';
        }

        // Destroy stale modal
        var existingInstance = bootstrap.Modal.getInstance(modalEl);
        if (existingInstance) existingInstance.dispose();
        var bsModal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

        var resolved = false;
        var promiseSettled = false;  // Tracks whether resolve() has been called

        function safeResolve(result) {
            if (promiseSettled) return;
            promiseSettled = true;
            resolve(result);
        }

        function finish(result) {
            if (resolved) return;
            resolved = true;
            // Remove listeners before hide
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);

            function afterHide() {
                modalEl.removeEventListener('hidden.bs.modal', afterHide);
                safeResolve(result);
            }
            modalEl.addEventListener('hidden.bs.modal', afterHide);

            try {
                bsModal.hide();
            } catch (e) {
                // If hide() fails (modal already hidden / Bootstrap stacking conflict),
                // resolve immediately so the caller is never stuck.
                modalEl.removeEventListener('hidden.bs.modal', afterHide);
                safeResolve(result);
            }

            // Safety timeout: if hidden.bs.modal never fires within 600ms, resolve anyway.
            // Bootstrap 5 cannot properly stack multiple modals; this prevents hangs.
            setTimeout(function() {
                modalEl.removeEventListener('hidden.bs.modal', afterHide);
                // Force-clean any orphaned modal state
                try {
                    var inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.dispose();
                } catch(ex) {}
                document.body.classList.remove('modal-open');
                var backdrops = document.querySelectorAll('.modal-backdrop');
                for (var i = 0; i < backdrops.length; i++) backdrops[i].remove();
                safeResolve(result);
            }, 600);
        }

        function onOk()     { finish(true);  }
        function onCancel() { finish(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);

        bsModal.show();
    });
}

async function loadTasks() {
    showGridLoading();

    if (currentProjectId === '' && sidebarProjects.length === 0) {
        await loadProjects();
    }

    try {
        var url = API;
        var params = [];
        if (currentProjectId != '') {
            // Project view
            if (currentFilter != '') params.push('status=' + currentFilter);
            params.push('project_id=' + currentProjectId);
        } else {
            // All Tasks view
            params.push('user=' + encodeURIComponent(currentUser.username));
            params.push('overview=1');
            if (currentFilter !== '') {
                params.push('status=' + currentFilter);
            }
        }
        if (params.length) url = API + '?' + params.join('&');

        var res = await fetch(url);

        if (!res.ok) {
            var err = await safeJson(res);
            showToast(err?.message || 'Server error ' + res.status + '.', false);
            showGridError();
            return;
        }

        var data = await res.json();

        if (data.success) {
            renderCards(data.data);
            updateStats(data.data);
        } else {
            showToast(data.message || 'Failed to load tasks.', false);
            showGridError();
        }

    } catch (err) {
        console.log('loadTasks error:', err);
        showToast('Cannot reach the API. Is the server running?', false);
        showGridError();
    }
}

function renderCards(tasks) {
    var grid = document.getElementById('taskGrid');

    if (!tasks.length) {
        grid.innerHTML = '<div class="empty"><i class="bi bi-inbox"></i><p class="mt-2">No tasks here. Add one!</p></div>';
        return;
    }

    if (currentProjectId === '') {
        // Split assignees
        var myRows    = [];
        var otherRows = [];
        var me = currentUser.username.trim().toLowerCase();
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            var rawAl = Array.isArray(t.assigned_to) ? t.assigned_to.join(',') : String(t.assigned_to);
            var al    = rawAl.split(',').map(function(n){ return n.trim().toLowerCase(); }).filter(function(n){ return n !== ''; });
            var ie    = al.length === 1 && al[0] === 'everyone';
            var ia    = ie || al.includes(me);
            var io    = (t.posted_by || '').trim().toLowerCase() === me;
            if (ia || io) { myRows.push(t); } else { otherRows.push(t); }
        }
        var priorityOrderR = { high: 0, medium: 1, low: 2 };
        myRows.sort(function(a, b) {
            var aDone = a.status === 'completed' ? 1 : 0;
            var bDone = b.status === 'completed' ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (priorityOrderR[a.priority] ?? 1) - (priorityOrderR[b.priority] ?? 1);
        });
        otherRows.sort(function(a, b) {
            var aDone = a.status === 'completed' ? 1 : 0;
            var bDone = b.status === 'completed' ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (priorityOrderR[a.priority] ?? 1) - (priorityOrderR[b.priority] ?? 1);
        });
        var ordered = myRows.concat(otherRows);

        var listHtml = '<div class="task-list-header">'
            + '<span>Status</span>'
            + '<span>Task</span>'
            + '<span>Priority</span>'
            + '<span><i class="bi bi-clock-history"></i> Posted</span>'
            + '<span><i class="bi bi-calendar3"></i> Due</span>'
            + '<span><i class="bi bi-person"></i> By</span>'
            + '<span></span>'
            + '</div>'
            + '<div class="tasks-list">';
        for (var i = 0; i < ordered.length; i++) {
            listHtml += buildRow(ordered[i]);
        }
        listHtml += '</div>';
        grid.innerHTML = listHtml;
    } else {
        // Sort: completed last, then by priority
        var priorityOrder = { high: 0, medium: 1, low: 2 };
        var sorted = tasks.slice().sort(function(a, b) {
            var aDone = a.status === 'completed' ? 1 : 0;
            var bDone = b.status === 'completed' ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
        });

        var myTasks    = [];
        var otherTasks = [];
        var me = currentUser.username.trim().toLowerCase();
        for (var i = 0; i < sorted.length; i++) {
            var t = sorted[i];
            var rawAssigned  = Array.isArray(t.assigned_to)
                ? t.assigned_to.join(',')
                : String(t.assigned_to);
            var assignedList = rawAssigned.split(',').map(function(n){ return n.trim().toLowerCase(); }).filter(function(n){ return n !== ''; });
            var isEveryone   = assignedList.length === 1 && assignedList[0] === 'everyone';
            var isAssigned   = isEveryone || assignedList.includes(me);
            var isOwner      = (t.posted_by || '').trim().toLowerCase() === me;
            if (isAssigned || isOwner) { myTasks.push(t); } else { otherTasks.push(t); }
        }

        var html = '';

        if (myTasks.length > 0) {
            html += '<div class="section-divider assigned-divider">'
                  + '<i class="bi bi-person-fill-check"></i>'
                  + '<span>My Tasks</span>'
                  + '<span class="section-count">' + myTasks.length + '</span>'
                  + '</div>'
                  + '<div class="cards-grid">';
            for (var i = 0; i < myTasks.length; i++) {
                html += buildCard(myTasks[i], String(myTasks[i].id) === _highlightTaskId);
            }
            html += '</div>';
        }

        if (otherTasks.length > 0) {
            html += '<div class="section-divider other-divider">'
                  + '<i class="bi bi-people-fill"></i>'
                  + '<span>Other Tasks</span>'
                  + '<span class="section-count">' + otherTasks.length + '</span>'
                  + '</div>'
                  + '<div class="cards-grid">';
            for (var i = 0; i < otherTasks.length; i++) {
                html += buildCard(otherTasks[i], String(otherTasks[i].id) === _highlightTaskId);
            }
            html += '</div>';
        }

        grid.innerHTML = html;
    }

    // Scroll + highlight task
    if (_highlightTaskId) {
        var targetId = _highlightTaskId;
        _highlightTaskId = null;
        setTimeout(function() {
            var el = document.getElementById('task-card-' + targetId);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('task-highlight');
            setTimeout(function() { el.classList.remove('task-highlight'); }, 2200);
        }, 80);
    }
}

function buildCard(task, highlight) {

    // Due date
    var dueText = '';
    if (task.due_date) {
        var dateObj = new Date(task.due_date + 'T00:00:00');
        dueText = dateObj.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Post date
    var postText = '';
    if (task.created_at) {
        var postObj = new Date(task.created_at);
        postText = postObj.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    var isDone = task.status === 'completed';

    var assignedList = Array.isArray(task.assigned_to) ? task.assigned_to : [String(task.assigned_to)];
    var isEveryone   = assignedList.length === 1 && assignedList[0].trim().toLowerCase() === 'everyone';

    var isOwner    = (task.posted_by || '').trim().toLowerCase() === currentUser.username.trim().toLowerCase();
    var isAssigned = isEveryone || assignedList.map(function(n) { return n.trim().toLowerCase(); }).includes(currentUser.username.trim().toLowerCase());

    var chipsHtml = '';
    if (isEveryone) {
        chipsHtml = '<span class="assign-chip everyone"><i class="bi bi-people-fill"></i> Everyone</span>';
    } else {
        for (var i = 0; i < assignedList.length; i++) {
            var assigneeName = assignedList[i].trim();
            var isMe = assigneeName.toLowerCase() === currentUser.username.trim().toLowerCase();
            chipsHtml += '<span class="assign-chip' + (isMe ? ' you' : '') + '">'
                + (isMe ? '<i class="bi bi-person-fill"></i> You' : escapeHTML(assigneeName))
                + '</span>';
        }
    }

    // Owner gets edit + delete
    
    var actionButtons = '';
    if (isOwner) {
        actionButtons = `
            <button class="ic-btn edit" onclick="event.stopPropagation();openEdit(${task.id})" title="Edit">
                <i class="bi bi-pencil"></i>
            </button>
            <button class="ic-btn del" onclick="event.stopPropagation();delTask(${task.id})" title="Delete">
                <i class="bi bi-trash"></i>
            </button>`;
    }

    var descHtml = '';
    if (task.description) {
        descHtml = '<div class="card-desc">' + escapeHTML(task.description) + '</div>';
    }

    var datesHtml = '<div class="card-dates">'
        + (postText ? '<span class="card-date-post"><i class="bi bi-clock-history"></i>' + postText + '</span>' : '')
        + (dueText
            ? '<span class="card-date-due"><i class="bi bi-calendar3"></i>' + dueText + '</span>'
            : '<span class="card-date-due no-due"><i class="bi bi-calendar-x"></i> No due date</span>')
        + '</div>';

    var cardClick = '';
    var cardCursor = '';
    if (!isOwner && isAssigned) {
        cardClick = 'onclick="openStatusModal(' + task.id + ', \'' + escapeHTML(task.status) + '\')"';
        cardCursor = ' style="cursor:pointer"';
    }

    // Build workers popover
    var workersPopover = buildWorkersPopover(task);

    var cardHTML = `
        <div id="task-card-${task.id}" class="task-card ${escapeHTML(task.priority)}${highlight ? ' task-highlight' : ''}" ${cardClick}${cardCursor}>
            <div class="card-top">
                <div class="card-title ${isDone ? 'done' : ''}">${escapeHTML(task.title)}</div>
                <div class="card-actions">
                    ${actionButtons}
                    <div class="task-dots-wrap" onclick="event.stopPropagation()">
                        <button class="task-dots-btn" title="Who's working on this?" onclick="toggleWorkers(this)">
                            <i class="bi bi-three-dots"></i>
                        </button>
                        ${workersPopover}
                    </div>
                </div>
            </div>

            ${descHtml}

            <div class="card-meta">
                <span class="badge b-${task.status}">${getStatusLabel(task.status)}</span>
                <span class="badge b-${task.priority}">${capitalize(task.priority)}</span>
            </div>

            ${datesHtml}

            <div class="card-people">
                <div class="people-row">
                    <span class="people-label"><i class="bi bi-person-circle"></i> Posted by</span>
                    <span class="people-value${isOwner ? ' you-value' : ''}">${isOwner ? '<i class="bi bi-person-fill"></i> You' : escapeHTML(task.posted_by || '—')}</span>
                </div>
                <div class="people-row">
                    <span class="people-label"><i class="bi bi-send"></i> Assigned to</span>
                    <div class="assign-chips">${chipsHtml}</div>
                </div>
                ${task.status === 'in_progress' && task.status_changed_by ? `
                <div class="people-row">
                    <span class="people-label"><i class="bi bi-arrow-repeat"></i> Working on this:</span>
                    <span class="people-value${task.status_changed_by.trim().toLowerCase() === currentUser.username.trim().toLowerCase() ? ' you-value' : ''}">${task.status_changed_by.trim().toLowerCase() === currentUser.username.trim().toLowerCase() ? '<i class="bi bi-person-fill"></i> You' : escapeHTML(task.status_changed_by)}</span>
                </div>` : ''}
                ${task.status === 'completed' && task.status_changed_by ? `
                <div class="people-row completed-by-row">
                    <span class="people-label"><i class="bi bi-check-circle-fill"></i> Completed by</span>
                    <span class="people-value completed-by-value${task.status_changed_by.trim().toLowerCase() === currentUser.username.trim().toLowerCase() ? ' you-value' : ''}">${task.status_changed_by.trim().toLowerCase() === currentUser.username.trim().toLowerCase() ? '<i class="bi bi-person-fill"></i> You' : escapeHTML(task.status_changed_by)}</span>
                </div>` : ''}
            </div>
        </div>`;

    return cardHTML;
}

function buildRow(task) {
    var isDone = task.status === 'completed';
    var isOwner  = (task.posted_by || '').trim().toLowerCase() === currentUser.username.trim().toLowerCase();

    var assignedList = Array.isArray(task.assigned_to) ? task.assigned_to : [String(task.assigned_to)];
    var isEveryone   = assignedList.length === 1 && assignedList[0].trim().toLowerCase() === 'everyone';
    var isAssigned   = isEveryone || assignedList.map(function(n){ return n.trim().toLowerCase(); }).includes(currentUser.username.trim().toLowerCase());

    var dueText = '';
    if (task.due_date) {
        var d = new Date(task.due_date + 'T00:00:00');
        dueText = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Post date
    var postText = '';
    if (task.created_at) {
        var pd = new Date(task.created_at);
        postText = pd.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Project name
    var projectName = '';
    if (task.project_id) {
        var proj = (sidebarProjects || []).find(function(p){ return String(p.id) === String(task.project_id); });
        projectName = proj ? proj.name : ('Project #' + task.project_id);
    }

    var safeTitle = JSON.stringify(task.title);
    var actionButtons = '';
    if (isOwner) {
        actionButtons = `<button class="ic-btn edit" onclick="event.stopPropagation();openEdit(${task.id})" title="Edit"><i class="bi bi-pencil"></i></button>
            <button class="ic-btn del" onclick="event.stopPropagation();delTask(${task.id})" title="Delete"><i class="bi bi-trash"></i></button>`;
    }

    // My Tasks: all clickable
    // No-project tasks: owner edits
    var rowClickAttr = '';
    var clickableClass = ' clickable-row';
    if (task.project_id) {
        rowClickAttr = 'onclick="goToProjectTask(' + task.project_id + ',' + task.id + ',event)"';
    } else if (!isOwner && isAssigned) {
        rowClickAttr = 'onclick="openStatusModal(' + task.id + ', \'' + task.status + '\')"';
    } else if (isOwner) {
        rowClickAttr = 'onclick="openEdit(' + task.id + ')"';
    } else {
        clickableClass = '';
    }
    var duePart = dueText
        ? '<span class="task-row-date"><i class="bi bi-calendar3"></i>' + dueText + '</span>'
        : '<span class="task-row-date no-due"><i class="bi bi-calendar-x"></i> No due date</span>';
    var postPart = postText
        ? '<span class="task-row-date"><i class="bi bi-clock-history"></i>' + postText + '</span>'
        : '';
    var completedByPart = (task.status === 'completed' && task.status_changed_by)
        ? (function() {
            var isMe = task.status_changed_by.trim().toLowerCase() === currentUser.username.trim().toLowerCase();
            return '<span class="task-row-completed-by' + (isMe ? ' you-poster' : '') + '" title="Completed by ' + (isMe ? 'You' : escapeHTML(task.status_changed_by)) + '">'
                + '<i class="bi bi-check-circle-fill"></i> ' + (isMe ? 'You' : escapeHTML(task.status_changed_by))
                + '</span>';
          })()
        : '';
    var workersPopover = buildWorkersPopover(task);
    var projectPart = projectName
        ? '<span class="task-row-project' + (task.project_id ? ' task-row-project-link' : '') + '">'
          + '<i class="bi bi-folder-fill"></i>' + escapeHTML(projectName)
          + (task.project_id ? ' <i class="bi bi-box-arrow-in-right task-row-nav-icon"></i>' : '')
          + '</span>'
        : '<span class="task-row-project no-proj" title="' + (isOwner ? 'Click row to edit' : 'Click row to update status') + '"><i class="bi bi-inbox"></i>No project</span>';
    return '<div class="task-row ' + escapeHTML(task.priority) + clickableClass + '" ' + rowClickAttr + '>'
        + '<div class="task-row-left">'
        +   '<span class="badge b-' + task.status + '">' + getStatusLabel(task.status) + '</span>'
        +   '<div class="task-row-main">'
        +     '<div class="task-row-line1">'
        +       '<span class="task-row-title ' + (isDone ? 'done' : '') + '">' + escapeHTML(task.title) + '</span>'
        +       projectPart
        +     '</div>'
        +     (completedByPart ? '<div class="task-row-line2">' + completedByPart + '</div>' : '')
        +   '</div>'
        + '</div>'
        + '<div class="task-row-right">'
        +   '<span class="badge b-' + task.priority + '">' + capitalize(task.priority) + '</span>'
        +   postPart
        +   duePart
        +   '<span class="task-row-poster' + (isOwner ? ' you-poster' : '') + '" title="Posted by ' + (isOwner ? 'You' : escapeHTML(task.posted_by)) + '">' + (isOwner ? '<i class="bi bi-person-fill"></i> You' : escapeHTML(task.posted_by)) + '</span>'
        +   '<div class="card-actions">'
        +     actionButtons
        +     '<div class="task-dots-wrap" onclick="event.stopPropagation()">'
        +       '<button class="task-dots-btn" title="Who\'s working on this?" onclick="toggleWorkers(this)">'
        +         '<i class="bi bi-three-dots"></i>'
        +       '</button>'
        +       workersPopover
        +     '</div>'
        +   '</div>'
        + '</div>'
        + '</div>';
}


function buildWorkersPopover(task) {
    var workers = [];
    if (task.status_changed_by) {
        workers = String(task.status_changed_by).split(',')
            .map(function(w) { return w.trim(); })
            .filter(function(w) { return w.length > 0; });
    }

    var listHtml = '';
    if (workers.length > 0) {
        for (var i = 0; i < workers.length; i++) {
            var isMe = workers[i].toLowerCase() === currentUser.username.trim().toLowerCase();
            var initials = workers[i].charAt(0).toUpperCase();
            listHtml += '<div class="task-worker-chip' + (isMe ? ' you-worker' : '') + '">'
                + '<span class="task-worker-avatar">' + (isMe ? '<i class="bi bi-person-fill"></i>' : escapeHTML(initials)) + '</span>'
                + '<span>' + (isMe ? 'You' : escapeHTML(workers[i])) + '</span>'
                + '</div>';
        }
    } else {
        listHtml = '<div class="task-workers-none">No one yet</div>';
    }

    return '<div class="task-workers-popover">'
        + '<div class="task-workers-title"><i class="bi bi-arrow-repeat"></i> Working on this</div>'
        + '<div class="task-workers-list">' + listHtml + '</div>'
        + '</div>';
}

function toggleWorkers(btn) {
    var wrap    = btn.closest('.task-dots-wrap');
    var popover = wrap.querySelector('.task-workers-popover');
    var isOpen  = popover.classList.contains('open');

    document.querySelectorAll('.task-workers-popover.open').forEach(function(p) {
        p.classList.remove('open');
    });
    document.querySelectorAll('.task-dots-btn.active').forEach(function(b) {
        b.classList.remove('active');
    });

    if (!isOpen) {
        popover.classList.add('open');
        btn.classList.add('active');
    }
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.task-dots-wrap')) {
        document.querySelectorAll('.task-workers-popover.open').forEach(function(p) {
            p.classList.remove('open');
        });
        document.querySelectorAll('.task-dots-btn.active').forEach(function(b) {
            b.classList.remove('active');
        });
    }
});

function updateStats(tasks) {
    var pendingCount  = 0;
    var progressCount = 0;
    var doneCount     = 0;

    for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].status === 'pending')     pendingCount++;
        if (tasks[i].status === 'in_progress') progressCount++;
        if (tasks[i].status === 'completed')   doneCount++;
    }

    // All stat cards visible
    var scTotal   = document.getElementById('sc-total');
    var scPending = document.getElementById('sc-pending');
    var scInprog  = document.getElementById('sc-inprog');
    var scDone    = document.getElementById('sc-done');

    scTotal.style.display   = '';
    scPending.style.display = '';
    scInprog.style.display  = '';
    scDone.style.display    = '';

    // Highlight active card
    scTotal.classList.toggle('sc-active',   currentFilter === '');
    scPending.classList.toggle('sc-active', currentFilter === 'pending');
    scInprog.classList.toggle('sc-active',  currentFilter === 'in_progress');
    scDone.classList.toggle('sc-active',    currentFilter === 'completed');

    if (currentFilter === '') {
        // No filter
        document.getElementById('stat-total').textContent   = tasks.length;
        document.getElementById('stat-pending').textContent = pendingCount;
        document.getElementById('stat-inprog').textContent  = progressCount;
        document.getElementById('stat-done').textContent    = doneCount;

        // Update sidebar totals
        if (currentProjectId === '') {
            document.getElementById('s-total').textContent    = tasks.length;
            document.getElementById('s-projects').textContent = (allProjects || []).length;
        }
        document.getElementById('s-pending').textContent  = pendingCount;
        document.getElementById('s-progress').textContent = progressCount;
        document.getElementById('s-done').textContent     = doneCount;
    } else {
        // Active filter
        if (currentFilter === 'pending')     document.getElementById('stat-pending').textContent = tasks.length;
        if (currentFilter === 'in_progress') document.getElementById('stat-inprog').textContent  = tasks.length;
        if (currentFilter === 'completed')   document.getElementById('stat-done').textContent    = tasks.length;
        loadOverviewStats();
    }
}

async function loadOverviewStats() {
    try {
        var url = currentProjectId !== '' ? (API + '?project_id=' + currentProjectId) : (API + '?user=' + encodeURIComponent(currentUser.username) + '&overview=1');
        var res  = await fetch(url);
        if (!res.ok) return;
        var data = await res.json();
        if (!data.success || !Array.isArray(data.data)) return;

        var p = 0, ip = 0, d = 0, total = data.data.length;
        for (var i = 0; i < data.data.length; i++) {
            if (data.data[i].status === 'pending')     p++;
            if (data.data[i].status === 'in_progress') ip++;
            if (data.data[i].status === 'completed')   d++;
        }

        document.getElementById('stat-total').textContent   = total;
        document.getElementById('stat-pending').textContent = p;
        document.getElementById('stat-inprog').textContent  = ip;
        document.getElementById('stat-done').textContent    = d;

        // Sidebar overview
        if (currentProjectId === '') {
            document.getElementById('s-total').textContent    = total;
            document.getElementById('s-projects').textContent = (allProjects || []).length;
        }
        document.getElementById('s-pending').textContent  = p;
        document.getElementById('s-progress').textContent = ip;
        document.getElementById('s-done').textContent     = d;
    } catch (e) { /* silently ignore */ }
}

// Sync filter UI
function _syncFilterUI(status) {
    var filterOrder   = ['', 'pending', 'in_progress', 'completed'];
    var selectedIndex = filterOrder.indexOf(status);

    var navButtons = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navButtons.length; i++) {
        // Sync nav-btns
        navButtons[i].classList.toggle('active', currentProjectId === '' && i === selectedIndex);
    }

    var filterButtons = document.querySelectorAll('.f-btn');
    for (var i = 0; i < filterButtons.length; i++) {
        filterButtons[i].classList.remove('active', 'f-pending', 'f-inprog', 'f-done');
        if (i === selectedIndex) {
            filterButtons[i].classList.add('active');
            if      (i === 1) filterButtons[i].classList.add('f-pending');
            else if (i === 2) filterButtons[i].classList.add('f-inprog');
            else if (i === 3) filterButtons[i].classList.add('f-done');
        }
    }
}

// Called by SIDEBAR nav buttons
function setFilter(status) {
    currentFilter    = status;
    currentProjectId = '';
    window._currentProjectIsOwn = false;

    document.getElementById('pageTitle').textContent = 'My Tasks';
    document.getElementById('pageSub').textContent   = 'Manage and track your to-dos';

    document.getElementById('btnAddTask').style.display     = 'none';
    document.getElementById('btnProjectMenu').style.display = 'none';
    closeProjectPanel();
    document.getElementById('projectPanel').dataset.loaded  = '';

    var items = document.querySelectorAll('.project-item');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('active');

    _syncFilterUI(status);
    loadTasks();
}

// Called by FILTER PILLS inside main
function setProjectFilter(status) {
    currentFilter = status;
    // Sync pills + nav
    _syncFilterUI(status);
    loadTasks();
}

function setAssignMode(mode) {
    assignMode = mode;

    if (mode === 'everyone') {
        document.getElementById('optEveryone').classList.add('active');
        document.getElementById('optSpecific').classList.remove('active');
        document.getElementById('assigneeWrapper').classList.add('hidden');
    } else {
        document.getElementById('optEveryone').classList.remove('active');
        document.getElementById('optSpecific').classList.add('active');
        document.getElementById('assigneeWrapper').classList.remove('hidden');
    }

    clearFieldError('err-assign');
}

function addAssigneeFromInput() {
    var input = document.getElementById('assigneeInput');
    var names = input.value.split(',');

    for (var i = 0; i < names.length; i++) {
        var name = names[i].trim();
        if (name != '' && !assignees.includes(name)) {
            assignees.push(name);
        }
    }

    input.value = '';
    renderTags();
    clearFieldError('err-assign');
}

function removeAssignee(name) {
    var newList = [];
    for (var i = 0; i < assignees.length; i++) {
        if (assignees[i] !== name) newList.push(assignees[i]);
    }
    assignees = newList;
    renderTags();
}

function renderTags() {
    var tagsContainer = document.getElementById('assigneeTags');
    var tagsHTML = '';

    for (var i = 0; i < assignees.length; i++) {
        tagsHTML += `
            <span class="tag">
                ${escapeHTML(assignees[i])}
                <button type="button" onclick="removeAssignee('${escapeHTML(assignees[i])}')">&times;</button>
            </span>`;
    }

    tagsContainer.innerHTML = tagsHTML;
}

function openAdd() {
    if (currentProjectId === '') {
        showToast('Please open a project first before adding a task.', false);
        return;
    }

    clearAllErrors();

    document.getElementById('modalTitle').textContent = 'Add Task';
    document.getElementById('taskId').value           = '';
    document.getElementById('taskTitle').value        = '';
    document.getElementById('taskDesc').value         = '';
    document.getElementById('taskDue').value          = '';
    document.getElementById('taskStatus').value       = 'pending';
    document.getElementById('taskPriority').value     = 'medium';

    assignees = [];
    renderTags();
    setAssignMode('everyone');

    var projectSel     = document.getElementById('taskProject');
    var projectDisplay = document.getElementById('taskProjectDisplay');

    projectSel.style.display   = 'none';
    projectDisplay.classList.remove('hidden');
    projectDisplay.textContent = document.getElementById('pageTitle').textContent;
    projectSel.value           = currentProjectId;

    modal.show();
}

async function openEdit(id) {
    clearAllErrors();

    try {
        var res = await fetch(API + '?id=' + id);

        if (!res.ok) {
            var err = await safeJson(res);
            showToast(err?.message || 'Failed to load task.', false);
            return;
        }

        var data = await res.json();

        if (!data.success) {
            showToast(data.message || 'Task not found.', false);
            return;
        }

        var task = data.data;

        document.getElementById('modalTitle').textContent = 'Edit Task';
        document.getElementById('taskId').value           = task.id;
        document.getElementById('taskTitle').value        = task.title;
        document.getElementById('taskDesc').value         = task.description || '';
        document.getElementById('taskStatus').value       = task.status;
        document.getElementById('taskPriority').value     = task.priority;
        document.getElementById('taskDue').value = task.due_date || '';

        var projectSel     = document.getElementById('taskProject');
        var projectDisplay = document.getElementById('taskProjectDisplay');

        if (currentProjectId !== '') {
            projectSel.style.display   = 'none';
            projectDisplay.classList.remove('hidden');
            projectDisplay.textContent = document.getElementById('pageTitle').textContent;
            projectSel.value           = currentProjectId;
        } else {
            projectSel.style.display   = '';
            projectDisplay.classList.add('hidden');
            projectSel.value           = task.project_id || '';
        }

        var assignedList = Array.isArray(task.assigned_to) ? task.assigned_to : [String(task.assigned_to)];
        var isEveryone   = assignedList.length === 1 && assignedList[0].trim().toLowerCase() === 'everyone';

        if (isEveryone) {
            assignees = [];
            setAssignMode('everyone');
        } else {
            assignees = [];
            for (var i = 0; i < assignedList.length; i++) {
                var name = assignedList[i].trim();
                if (name != '') assignees.push(name);
            }
            setAssignMode('specific');
            renderTags();
        }

        modal.show();

    } catch (err) {
        console.log('openEdit error:', err);
        showToast('Could not load task details.', false);
    }
}

async function saveTask() {
    clearAllErrors();

    var saveBtn = document.querySelector('#taskModal .btn-save');
    if (saveBtn && saveBtn.disabled) return;

    var hasError = false;
    var id       = document.getElementById('taskId').value;
    var title    = document.getElementById('taskTitle').value.trim();

    if (!title) {
        setFieldError('err-title', 'Title is required.');
        document.getElementById('taskTitle').focus();
        hasError = true;
    } else if (title.length > 150) {
        setFieldError('err-title', 'Title must be 150 characters or fewer.');
        hasError = true;
    }

    var assignedTo;

    if (assignMode === 'everyone') {
        assignedTo = 'Everyone';
    } else {
        var extraInput = document.getElementById('assigneeInput').value.trim();
        if (extraInput != '') {
            var extraNames = extraInput.split(',');
            for (var i = 0; i < extraNames.length; i++) {
                var name = extraNames[i].trim();
                if (name != '' && !assignees.includes(name)) assignees.push(name);
            }
            document.getElementById('assigneeInput').value = '';
            renderTags();
        }

        if (assignees.length === 0) {
            setFieldError('err-assign', 'Add at least one name, or switch to "Everyone".');
            hasError = true;
        } else {
            assignedTo = assignees;
        }
    }

    if (hasError) return;

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    var taskData = {
        title:       title,
        description: document.getElementById('taskDesc').value,
        status:      document.getElementById('taskStatus').value,
        priority:    document.getElementById('taskPriority').value,
        due_date:    document.getElementById('taskDue').value || null,
        posted_by:   currentUser.username,
        assigned_to: assignedTo,
        project_id:  document.getElementById('taskProject').value || null,
        changed_by:  currentUser.username,
    };

    if (id) {
        taskData.id = id;
    }

    try {
        var requestMethod = id ? 'PUT' : 'POST';

        var res = await fetch(API, {
            method:  requestMethod,
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(taskData),
        });

        var data = await safeJson(res);

        if (data && data.success) {
            window._modalSavedOk = true;
            modal.hide();
            showToast(data.message || 'Task saved.', true);
            loadTasks();
        } else {
            showToast(data?.message || 'Failed to save task.', false);
        }

    } catch (err) {
        console.log('saveTask error:', err);
        showToast('Network error — could not save task.', false);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Task'; }
    }
}

async function delTask(id) {
    try {
        var res  = await fetch(API + '?id=' + id + '&user=' + encodeURIComponent(currentUser.username), { method: 'DELETE' });
        var data = await safeJson(res);
        if (data && data.success) {
            showToast('Task deleted.', true);
            loadTasks();
        } else {
            showToast(data?.message || 'Failed to delete task.', false);
        }
    } catch (err) {
        showToast('Network error — could not delete task.', false);
    }
}

async function updateStatus(id, newStatus) {
    try {
        var res  = await fetch(API + '?id=' + id);
        var data = await res.json();

        if (!data.success) {
            showToast('Could not load task.', false);
            return;
        }

        var task = data.data;

        var assignedList = Array.isArray(task.assigned_to) ? task.assigned_to : [String(task.assigned_to)];
        var isEveryone   = assignedList.length === 1 && assignedList[0].trim().toLowerCase() === 'everyone';
        var isAssigned   = isEveryone || assignedList.map(function(n){ return n.trim().toLowerCase(); }).includes(currentUser.username.trim().toLowerCase());

        var updatedTask = {
            id:          id,
            title:       task.title,
            description: task.description,
            status:      newStatus,
            priority:    task.priority,
            due_date:    task.due_date,
            posted_by:   task.posted_by,
            assigned_to: task.assigned_to,
            project_id:  task.project_id || null,
            changed_by:  isAssigned ? currentUser.username : '',
        };

        var res2  = await fetch(API, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(updatedTask),
        });

        var data2 = await safeJson(res2);

        if (data2 && data2.success) {
            showToast('Status updated!', true);
            loadTasks();
        } else {
            showToast(data2?.message || 'Failed to update status.', false);
        }

    } catch (err) {
        showToast('Network error.', false);
    }
}

async function openStatusModal(taskId, currentStatus) {
    var statusModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('statusModal'));

    // Populate modal
    document.getElementById('smTaskId').value = taskId;
    var radios = document.querySelectorAll('input[name="smStatus"]');
    for (var i = 0; i < radios.length; i++) {
        radios[i].checked = radios[i].value === currentStatus;
    }

    // Show task title
    try {
        var res  = await fetch(API + '?id=' + taskId);
        var data = await res.json();
        if (data.success) {
            document.getElementById('smTaskTitle').textContent = data.data.title;
        }
    } catch(e) { document.getElementById('smTaskTitle').textContent = ''; }

    statusModal.show();
}

async function saveStatusModal() {
    var taskId = document.getElementById('smTaskId').value;
    var radios = document.querySelectorAll('input[name="smStatus"]');
    var newStatus = '';
    for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) { newStatus = radios[i].value; break; }
    }
    if (!newStatus) return;

    var smBtn = document.getElementById('smSaveBtn');
    smBtn.disabled = true;

    try {
        await updateStatus(taskId, newStatus);
        var modalEl = document.getElementById('statusModal');
        var inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    } finally {
        smBtn.disabled = false;
    }
}

function showToast(message, isSuccess) {
    var icon = isSuccess
        ? 'check-circle-fill text-success'
        : 'x-circle-fill text-danger';

    document.getElementById('toastMsg').innerHTML = '<i class="bi bi-' + icon + '"></i> ' + message;
    toast.show();
}

function showGridLoading() {
    document.getElementById('taskGrid').innerHTML = `
        <div class="empty">
            <div class="spinner-border text-secondary mb-3" role="status"></div>
            <p>Loading tasks…</p>
        </div>`;
}

function showGridError() {
    document.getElementById('taskGrid').innerHTML = `
        <div class="empty">
            <i class="bi bi-exclamation-circle"></i>
            <p class="mt-2">Could not load tasks. Check your connection and try again.</p>
        </div>`;
}

function setFieldError(id, message) {
    var el = document.getElementById(id);
    if (el) {
        el.textContent   = message;
        el.style.display = 'block';
    }
}

function clearFieldError(id) {
    var el = document.getElementById(id);
    if (el) {
        el.textContent   = '';
        el.style.display = 'none';
    }
}

function clearAllErrors() {
    clearFieldError('err-title');
    clearFieldError('err-assign');
    clearFieldError('err-project');
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (e) {
        return null;
    }
}

function escapeHTML(text) {
    var str = String(text);
    str = str.replace(/&/g, '&amp;');
    str = str.replace(/</g, '&lt;');
    str = str.replace(/>/g, '&gt;');
    str = str.replace(/"/g, '&quot;');
    return str;
}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function getStatusLabel(status) {
    if (status === 'pending')     return 'Pending';
    if (status === 'in_progress') return 'In Progress';
    if (status === 'completed')   return 'Completed';
    return status;
}

async function loadProjects() {
    try {
        var res  = await fetch(API + '?resource=projects&user=' + encodeURIComponent(currentUser.username));
        var data = await res.json();
        if (data.success) renderProjectList(data.data);
    } catch (err) {
        console.log('loadProjects error:', err);
    }
}

// Sidebar projects
// SearchProjects
var sidebarProjects = [];

function renderProjectList(projects) {
    sidebarProjects = projects;
    allProjects     = projects;
    renderFilteredProjects(false);
    populateProjectDropdown(projects);
}

function toggleStar(e, projectId) {
    e.stopPropagation();
    var key = String(projectId);
    if (starredProjects[key]) {
        delete starredProjects[key];
    } else {
        starredProjects[key] = true;
    }
    try { localStorage.setItem('tf_starred', JSON.stringify(starredProjects)); } catch(ex) {}
    renderFilteredProjects(document.getElementById('projectSearch').value.trim() !== '');
}

function renderFilteredProjects(isSearchMode) {
    var list     = document.getElementById('projectList');
    var filtered = allProjects.slice();  // Copy

    if (!filtered.length) {
        list.innerHTML = '<div style="font-size:.75rem;color:var(--muted);padding:.3rem .4rem">'
                       + (isSearchMode ? 'No results.' : 'No projects yet.')
                       + '</div>';
        return;
    }

    filtered.sort(function(a, b) {
        var aStarred = starredProjects[String(a.id)] ? 1 : 0;
        var bStarred = starredProjects[String(b.id)] ? 1 : 0;
        function rank(p) {
            if (p.created_by === currentUser.username) return 0;
            if (p.is_member == 1 && p.is_pending != 1) return 1;
            if (p.is_pending == 1) return 2;
            return 1;
        }
        var ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        return bStarred - aStarred;  // Starred first
    });

    function buildProjectItem(p) {
        var isActive     = String(p.id) === String(currentProjectId);
        var isOwn        = p.created_by === currentUser.username;
        var isMember     = p.is_member == 1;
        var isPending    = p.is_pending == 1;
        var pendingCount = parseInt(p.pending_requests) || 0;
        var isStarred    = !!starredProjects[String(p.id)];
        var canOpen = isOwn || (isMember && !isPending);

        var clickHandler = canOpen
            ? 'selectProject(' + p.id + ', this)'
            : 'openProjectInfo(' + p.id + ')';

        var folderIcon = isOwn
            ? 'bi-folder'
            : (isMember && !isPending)
                ? 'bi-folder-symlink'
                : isPending
                    ? 'bi-hourglass-split'
                    : 'bi-folder-x';

        var itemClass = 'project-item'
            + (isActive    ? ' active'   : '')
            + (!canOpen    ? ' unjoined' : '')
            + (isPending   ? ' pending'  : '');

        var out = '<div class="' + itemClass + '" onclick="' + clickHandler + '">'
                + '<i class="bi ' + folderIcon + '"></i>'
                + '<span>' + escapeHTML(p.name) + '</span>';

        if (isOwn && pendingCount > 0) {
            out += '<span class="badge-requests" onclick="event.stopPropagation();openRequestsModal(' + p.id + ')" title="' + pendingCount + ' join request(s)">' + pendingCount + '</span>';
        }

        out += '<div class="project-item-actions" onclick="event.stopPropagation()">';

        // Star button
        if (canOpen || isPending) {
            out += '<button class="btn-star-project' + (isStarred ? ' starred' : '') + '" '
                 + 'onclick="toggleStar(event,' + p.id + ')" '
                 + 'title="' + (isStarred ? 'Unstar' : 'Star') + ' project">'
                 + '<i class="bi ' + (isStarred ? 'bi-star-fill' : 'bi-star') + '"></i>'
                 + '</button>';
        }

        if (isOwn) {
            // Owner
        } else if (isMember && !isPending) {
            out += '<button class="btn-leave-project" onclick="leaveProject(event,' + p.id + ')" title="Leave project"><i class="bi bi-box-arrow-left"></i></button>';
        } else if (isPending) {
            out += '<span class="pending-label" title="Awaiting owner approval">Pending</span>';
        } else if (isSearchMode) {
            out += '<span style="font-size:.7rem;color:var(--muted)" title="Click to view &amp; join"><i class="bi bi-box-arrow-in-right"></i></span>';
        }

        out += '</div></div>';
        return out;
    }

    // Separate starred vs non-starred for visual grouping
    var starredItems = filtered.filter(function(p) { return !!starredProjects[String(p.id)]; });
    var otherItems   = filtered.filter(function(p) { return !starredProjects[String(p.id)]; });

    var html = '';
    if (starredItems.length > 0) {
        html += '<div class="project-group-label"><i class="bi bi-star-fill" style="color:var(--warn);font-size:.6rem"></i> Starred</div>';
        for (var i = 0; i < starredItems.length; i++) html += buildProjectItem(starredItems[i]);
        if (otherItems.length > 0) {
            html += '<div class="project-group-label" style="margin-top:.3rem">All Projects</div>';
        }
    }
    for (var i = 0; i < otherItems.length; i++) html += buildProjectItem(otherItems[i]);

    list.innerHTML = html;
}

async function filterProjects(query) {
    query = query.trim();

    try {
        var res, data;
        if (query !== '') {
            // Search mode
            res  = await fetch(API + '?resource=projects&search=' + encodeURIComponent(query) + '&user=' + encodeURIComponent(currentUser.username));
            data = await res.json();
            if (data.success) {
                allProjects = data.data;
                renderFilteredProjects(true);
                // Don't update dropdown with search results
            }
        } else {
            // Cleared search
            await loadProjects();
        }
    } catch (err) {
        console.log('filterProjects error:', err);
    }
}

function populateProjectDropdown(projects) {
    var sel     = document.getElementById('taskProject');
    var current = sel.value;
    sel.innerHTML = '<option value="">— No project —</option>';
    for (var i = 0; i < projects.length; i++) {
        // Only show projects the user owns or is an accepted member of
        if (projects[i].is_pending == 1) continue;
        var opt       = document.createElement('option');
        opt.value     = projects[i].id;
        opt.textContent = projects[i].name;
        sel.appendChild(opt);
    }
    sel.value = current;
}

async function selectProject(id, el) {
    // Verify the user is an accepted member or owner
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    if (proj && !proj.created_by) {
        showToast('Cannot open this project.', false);
        return;
    }
    var isOwn    = proj && proj.created_by === currentUser.username;
    var isMember = proj && proj.is_member == 1;
    if (!isOwn && !isMember) {
        showToast('Your request to join this project is still pending approval.', false);
        return;
    }

    currentProjectId = String(id);

    var projectName = proj ? proj.name : (el && el.querySelector('span') ? el.querySelector('span').textContent : 'Project');
    document.getElementById('pageTitle').textContent = projectName;
    document.getElementById('pageSub').textContent   = 'Tasks in this project';

    var items = document.querySelectorAll('.project-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('active');
    }
    if (el) el.classList.add('active');

    currentFilter = '';

    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
        navBtns[i].classList.remove('active');
    }

    var fBtns = document.querySelectorAll('.f-btn');
    for (var i = 0; i < fBtns.length; i++) {
        fBtns[i].classList.remove('active', 'f-pending', 'f-inprog', 'f-done');
        if (i === 0) fBtns[i].classList.add('active');
    }

    // Show project UI controls
    document.getElementById('btnAddTask').style.display     = '';
    document.getElementById('btnProjectMenu').style.display = '';

    // Close panel if open
    var panel = document.getElementById('projectPanel');
    panel.style.display = 'none';
    panel.dataset.loaded = '';
    // Store ownership for this project (check allProjects)
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    window._currentProjectIsOwn = proj ? (proj.created_by === currentUser.username) : false;
    updateProjectMenuButtons();

    loadTasks();
}

function goToProject(id, e) {
    if (e) e.stopPropagation();
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    if (!proj) {
        // Reload projects then navigate
        loadProjects().then(function() {
            var p2 = sidebarProjects.find(function(p) { return String(p.id) === String(id); });
            if (p2) _doSelectProject(id, p2);
        });
        return;
    }
    _doSelectProject(id, proj);
}

function goToProjectTask(projectId, taskId, e) {
    if (e) e.stopPropagation();
    _highlightTaskId = String(taskId);
    var proj = allProjects.find(function(p) { return String(p.id) === String(projectId); });
    if (!proj) {
        loadProjects().then(function() {
            var p2 = sidebarProjects.find(function(p) { return String(p.id) === String(projectId); });
            if (p2) _doSelectProject(projectId, p2);
            else { _highlightTaskId = null; showToast('Project not found.', false); }
        });
        return;
    }
    _doSelectProject(projectId, proj);
}

function _doSelectProject(id, proj) {
    var isOwn    = proj.created_by === currentUser.username;
    var isMember = proj.is_member == 1;
    if (!isOwn && !isMember) {
        _highlightTaskId = null;  // Clear stale highlight target
        showToast("Your join request is still pending approval.", false);
        return;
    }
    currentProjectId = String(id);
    currentFilter = "";
    document.getElementById("pageTitle").textContent = proj.name;
    document.getElementById("pageSub").textContent   = "Tasks in this project";
    document.getElementById("btnAddTask").style.display     = "";
    document.getElementById("btnProjectMenu").style.display = "";
    closeProjectPanel();
    document.getElementById("projectPanel").dataset.loaded  = "";
    var items = document.querySelectorAll(".project-item");
    for (var i = 0; i < items.length; i++) items[i].classList.remove("active");
    // Mark active in sidebar and briefly flash it
    var sideItems = document.querySelectorAll(".project-item");
    for (var i = 0; i < sideItems.length; i++) {
        if (sideItems[i].getAttribute("onclick") && sideItems[i].getAttribute("onclick").indexOf("selectProject(" + id) !== -1) {
            sideItems[i].classList.add("active");
            sideItems[i].classList.add("project-item-flash");
            (function(el) {
                setTimeout(function() { el.classList.remove("project-item-flash"); }, 800);
            })(sideItems[i]);
        }
    }
    var navBtns = document.querySelectorAll(".nav-btn");
    for (var i = 0; i < navBtns.length; i++) navBtns[i].classList.remove("active");
    var fBtns = document.querySelectorAll(".f-btn");
    for (var i = 0; i < fBtns.length; i++) { fBtns[i].classList.remove("active", "f-pending", "f-inprog", "f-done"); if (i === 0) fBtns[i].classList.add("active"); }
    window._currentProjectIsOwn = (proj.created_by === currentUser.username);
    updateProjectMenuButtons();
    var searchBox = document.getElementById("projectSearch");
    if (searchBox && searchBox.value.trim() !== "") {
        searchBox.value = "";
        loadProjects();
    }
    loadTasks();
}

async function joinProject(e, id) {
    e.stopPropagation();
    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'request_join', project_id: id, username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            showToast('Join request sent! Waiting for owner approval.', true);
            await loadProjects();
        } else {
            showToast(data?.message || 'Could not send join request.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}

async function leaveProject(e, id) {
    e.stopPropagation();
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    var projName = proj ? proj.name : 'this project';
    var confirmed = await showConfirm({
        type:    'warning',
        icon:    'bi-box-arrow-left',
        title:   'Leave Project?',
        sub:     'You\'re about to leave <strong>' + escapeHTML(projName) + '</strong>.',
        warning: 'You\'ll lose access to its tasks. You can request to rejoin later.',
        okLabel: 'Leave Project',
        cancelLabel: 'Stay',
    });
    if (!confirmed) return;
    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'leave', project_id: id, username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            if (String(currentProjectId) === String(id)) {
                currentProjectId = '';
                document.getElementById('pageTitle').textContent = 'My Tasks';
                document.getElementById('pageSub').textContent   = 'Manage and track your to-dos';
            }
            showToast('Left project.', true);
            await loadProjects();
            loadTasks();
        } else {
            showToast(data?.message || 'Could not leave project.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}

var currentVisibility = 'public';
var starredProjects   = {};

function setVisibility(mode) {
    currentVisibility = mode;
    document.getElementById('visPublic').classList.toggle('active', mode === 'public');
    document.getElementById('visPrivate').classList.toggle('active', mode === 'private');
}

function openNewProject() {
    document.getElementById('projectName').value = '';
    if (document.getElementById('projectDesc')) document.getElementById('projectDesc').value = '';
    clearFieldError('err-project');
    setVisibility('public');
    projectModal.show();
}

async function saveProject() {
    clearFieldError('err-project');

    var name = document.getElementById('projectName').value.trim();
    if (!name) {
        setFieldError('err-project', 'Project name is required.');
        return;
    }

    try {
        var desc = document.getElementById('projectDesc') ? document.getElementById('projectDesc').value.trim() : '';
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: name, description: desc, created_by: currentUser.username, visibility: currentVisibility }),
        });
        var data = await safeJson(res);

        if (data && data.success) {
            projectModal.hide();
            showToast('Project created!', true);
            currentProjectId = String(data.data.id);
            document.getElementById('pageTitle').textContent = data.data.name;
            document.getElementById('pageSub').textContent   = 'Tasks in this project';
            document.getElementById('btnAddTask').style.display     = '';
            document.getElementById('btnProjectMenu').style.display = '';
            window._currentProjectIsOwn = true;  // Creator is always owner
            currentFilter = '';
            var navBtns = document.querySelectorAll('.nav-btn');
            for (var i = 0; i < navBtns.length; i++) navBtns[i].classList.remove('active');
            var fBtns = document.querySelectorAll('.f-btn');
            for (var i = 0; i < fBtns.length; i++) {
                fBtns[i].classList.remove('active');
                if (i === 0) fBtns[i].classList.add('active');
            }
            await loadProjects();
            loadTasks();
        } else {
            setFieldError('err-project', data?.message || 'Failed to create project.');
        }
    } catch (err) {
        setFieldError('err-project', 'Network error.');
    }
}

async function openRequestsModal(projectId) {
    projectId = parseInt(projectId);
    if (!projectId || projectId <= 0) {
        projectId = parseInt(currentProjectId);
    }
    if (!projectId || projectId <= 0) {
        showToast('Cannot determine project for join requests.', false);
        return;
    }
    var project = allProjects.find(function(p) { return String(p.id) === String(projectId); });
    var projectName = project ? project.name : document.getElementById('pageTitle').textContent;
    var modal = document.getElementById('requestsModal');
    document.getElementById('requestsModalTitle').textContent = 'Join Requests — ' + projectName;
    document.getElementById('requestsProjectId').value = projectId;
    document.getElementById('requestsList').innerHTML = '<div style="color:var(--muted);font-size:.82rem">Loading…</div>';

    var bsModal = bootstrap.Modal.getInstance(modal) || new bootstrap.Modal(modal);
    bsModal.show();

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'get_requests', owner: currentUser.username, project_id: parseInt(projectId) }),
        });
        var data = await safeJson(res);

        var requests = (data && data.success ? data.data : []);

        var list = document.getElementById('requestsList');
        if (!requests.length) {
            list.innerHTML = '<div style="color:var(--muted);font-size:.82rem">No pending requests.</div>';
            return;
        }

        var html = '';
        // Store requests globally
        window._pendingRequests = requests;

        for (var i = 0; i < requests.length; i++) {
            var r = requests[i];
            html += '<div class="request-row" id="req-' + r.id + '">'
                  + '<div class="request-user"><i class="bi bi-person-circle"></i> ' + escapeHTML(r.username) + '</div>'
                  + '<div class="request-btns">'
                  + '<button class="btn-req-accept" onclick="respondJoin(' + i + ',true,this)"><i class="bi bi-check-lg"></i> Accept</button>'
                  + '<button class="btn-req-decline" onclick="respondJoin(' + i + ',false,this)"><i class="bi bi-x-lg"></i> Decline</button>'
                  + '</div></div>';
        }
        list.innerHTML = html;
    } catch (err) {
        document.getElementById('requestsList').innerHTML = '<div style="color:var(--danger);font-size:.82rem">Failed to load requests.</div>';
    }
}

async function respondJoin(index, accept, btn) {
    var r = window._pendingRequests[index];
    if (!r) return;
    var projectId = r.project_id;
    var username  = r.username;
    btn.disabled = true;
    var row = btn.closest('.request-row');
    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'respond_join', project_id: projectId, username: username, owner: currentUser.username, accept: accept }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            row.style.opacity = '0.4';
            row.style.pointerEvents = 'none';
            row.querySelector('.request-btns').innerHTML = '<span style="font-size:.75rem;color:var(--muted)">' + (accept ? '✓ Accepted' : '✗ Declined') + '</span>';
            // Remove from in-memory list
            window._pendingRequests[index] = null;
            showToast(data.message, true);
            // Reload sidebar
            loadProjects();
            // Bust the project panel cache
            var panel = document.getElementById('projectPanel');
            panel.dataset.loaded = '';
            panel.dataset.loadedFor = '';
            if (String(currentProjectId) === String(projectId) && panel.style.display !== 'none') {
                loadProjectPanel(projectId);
            } else {
                fetchPendingCount(projectId);
            }
        } else {
            showToast(data?.message || 'Failed to respond.', false);
            btn.disabled = false;
        }
    } catch (err) {
        showToast('Network error.', false);
        btn.disabled = false;
    }
}

async function fetchPendingCount(projectId) {
    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'get_requests', owner: currentUser.username, project_id: parseInt(projectId) }),
        });
        var data = await safeJson(res);
        var requests = (data && data.success ? data.data : []);
        var countEl = document.getElementById('ppReqCount');
        if (countEl) {
            if (requests.length > 0) {
                countEl.textContent = requests.length;
                countEl.style.display = '';
            } else {
                countEl.style.display = 'none';
            }
        }
    } catch(e) {}
}

function updateProjectMenuButtons() {
    // Owner-only controls inside the project panel
    var isOwn = window._currentProjectIsOwn || false;
    var ownerControls = document.querySelectorAll('.pp-owner-only');
    for (var i = 0; i < ownerControls.length; i++) {
        ownerControls[i].style.display = isOwn ? '' : 'none';
    }
    var memberControls = document.querySelectorAll('.pp-member-only');
    for (var i = 0; i < memberControls.length; i++) {
        memberControls[i].style.display = isOwn ? 'none' : '';
    }
}

var projectPanelOpen = false;

function toggleProjectPanel() {
    var panel    = document.getElementById('projectPanel');
    var backdrop = document.getElementById('panelBackdrop');
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display    = 'block';
        backdrop.style.display = 'block';
        projectPanelOpen = true;
        if (!panel.dataset.loaded || panel.dataset.loadedFor !== String(currentProjectId)) {
            loadProjectPanel(currentProjectId);
        }
    } else {
        closeProjectPanel();
    }
}

function closeProjectPanel() {
    document.getElementById('projectPanel').style.display  = 'none';
    document.getElementById('panelBackdrop').style.display = 'none';
    projectPanelOpen = false;
}

async function loadProjectPanel(projectId) {
    var panel = document.getElementById('projectPanel');
    document.getElementById('ppDescription').textContent = 'Loading…';
    document.getElementById('ppOwner').textContent       = '—';
    document.getElementById('ppCreated').textContent     = '—';
    document.getElementById('ppRole').innerHTML          = '—';
    document.getElementById('ppMembers').innerHTML       = '<span style="color:var(--muted);font-size:.8rem">Loading…</span>';

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'get_project_details', project_id: projectId, username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (!data || !data.success) return;
        var p = data.data;

        document.getElementById('ppDescription').textContent = p.description || 'No description.';
        document.getElementById('ppOwner').textContent       = p.created_by;
        var d = new Date(p.created_at);
        document.getElementById('ppCreated').textContent = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

        var roleMap = {
            owner:    '<span class="pi-badge owner"><i class="bi bi-star-fill"></i> Owner</span>',
            accepted: '<span class="pi-badge member"><i class="bi bi-check-circle-fill"></i> Member</span>',
            pending:  '<span class="pi-badge pending"><i class="bi bi-hourglass-split"></i> Pending</span>',
            none:     '<span class="pi-badge none"><i class="bi bi-x-circle"></i> Not a member</span>',
        };
        document.getElementById('ppRole').innerHTML = roleMap[p.approval_status] || p.approval_status;

        // Visibility display
        var vis = p.visibility || 'public';
        if (document.getElementById('ppVisibility')) {
            document.getElementById('ppVisibility').innerHTML = vis === 'public'
                ? '<span class="pi-badge member"><i class="bi bi-globe"></i> Public</span>'
                : '<span class="pi-badge pending"><i class="bi bi-lock-fill"></i> Private</span>';
        }

        window._currentProjectIsOwn = (p.approval_status === 'owner');
        updateProjectMenuButtons();

        // Leave button
        var leaveBtn = document.getElementById('ppBtnLeave');
        leaveBtn.style.display = (p.approval_status === 'accepted') ? '' : 'none';
        leaveBtn.dataset.projectId = projectId;

        // Requests button: only for owners
        var reqBtn = document.getElementById('ppBtnRequests');
        if (reqBtn) {
            reqBtn.style.display = (p.approval_status === 'owner') ? '' : 'none';
            reqBtn.dataset.projectId = projectId;
            // Fetch pending request count for owner badge
            if (p.approval_status === 'owner') {
                fetchPendingCount(projectId);
            }
        }

        // Visibility toggle button
        var visBtn = document.getElementById('ppBtnVisibility');
        if (visBtn) {
            var vis = p.visibility || 'public';
            visBtn.dataset.visibility = vis;
            document.getElementById('ppVisIcon').className = vis === 'public' ? 'bi bi-globe' : 'bi bi-lock-fill';
            document.getElementById('ppVisLabel').textContent = vis === 'public' ? 'Public' : 'Private';
        }

        var allMembers = [p.created_by].concat(p.members.filter(function(m) { return m !== p.created_by; }));
        var html = '';
        for (var i = 0; i < allMembers.length; i++) {
            var isOwnerChip = allMembers[i] === p.created_by;
            html += '<span class="pi-member-chip' + (isOwnerChip ? ' is-owner' : '') + '">'
                  + '<i class="bi bi-person-circle"></i> ' + escapeHTML(allMembers[i])
                  + (isOwnerChip ? ' <small>owner</small>' : '')
                  + '</span>';
        }
        document.getElementById('ppMembers').innerHTML = html || '<span style="color:var(--muted);font-size:.8rem">No members yet.</span>';

        panel.dataset.loaded = '1';
        panel.dataset.loadedFor = String(currentProjectId);
    } catch (err) {
        document.getElementById('ppDescription').textContent = 'Failed to load details.';
    }
}

function toggleDescEdit() {
    var desc     = document.getElementById('ppDescription');
    var textarea = document.getElementById('ppDescTextarea');
    var actions  = document.getElementById('ppDescActions');
    var editBtn  = document.getElementById('ppDescEditBtn');

    textarea.value = desc.textContent === 'No description.' ? '' : desc.textContent;
    desc.style.display     = 'none';
    textarea.style.display = '';
    actions.style.display  = 'flex';
    editBtn.style.display  = 'none';
    textarea.focus();
}

function cancelDescEdit() {
    var desc     = document.getElementById('ppDescription');
    var textarea = document.getElementById('ppDescTextarea');
    var actions  = document.getElementById('ppDescActions');
    var editBtn  = document.getElementById('ppDescEditBtn');

    desc.style.display     = '';
    textarea.style.display = 'none';
    actions.style.display  = 'none';
    editBtn.style.display  = '';
}

async function saveDescription() {
    var desc     = document.getElementById('ppDescription');
    var textarea = document.getElementById('ppDescTextarea');
    var newDesc  = textarea.value.trim();

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                action:      'update_description',
                project_id:  parseInt(currentProjectId),
                owner:       currentUser.username,
                description: newDesc,
            }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            desc.textContent = newDesc || 'No description.';
            cancelDescEdit();
            showToast('Description updated!', true);
            // Bust panel cache
            document.getElementById('projectPanel').dataset.loaded = '';
        } else {
            showToast(data?.message || 'Failed to update description.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}

async function leaveFromPanel() {
    var id = document.getElementById('ppBtnLeave').dataset.projectId;
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    var projName = proj ? proj.name : document.getElementById('pageTitle').textContent;
    var confirmed = await showConfirm({
        type:    'warning',
        icon:    'bi-box-arrow-left',
        title:   'Leave Project?',
        sub:     'You\'re about to leave <strong>' + escapeHTML(projName) + '</strong>.',
        warning: 'You\'ll lose access to its tasks. You can request to rejoin later.',
        okLabel: 'Leave Project',
        cancelLabel: 'Stay',
    });
    if (!confirmed) return;
    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'leave', project_id: parseInt(id), username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            showToast('You left the project.', true);
            // Reset to general view
            currentProjectId = '';
            document.getElementById('pageTitle').textContent = 'My Tasks';
            document.getElementById('pageSub').textContent   = 'Manage and track your to-dos';
            document.getElementById('btnAddTask').style.display     = 'none';
            document.getElementById('btnProjectMenu').style.display = 'none';
            closeProjectPanel();
            document.getElementById('projectPanel').dataset.loaded   = '';
            await loadProjects();
            loadTasks();
        } else {
            showToast(data?.message || 'Could not leave project.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}

// Track which project the info modal is currently showing
var _infoModalProjectId = null;

async function openProjectInfo(projectId) {
    _infoModalProjectId = projectId;
    var infoModalEl = document.getElementById('projectInfoModal');
    var infoModal = bootstrap.Modal.getInstance(infoModalEl) || new bootstrap.Modal(infoModalEl);

    // Reset UI
    document.getElementById('piName').textContent        = 'Loading…';
    document.getElementById('piOwner').textContent       = '—';
    document.getElementById('piCreated').textContent     = '—';
    document.getElementById('piStatus').innerHTML        = '—';
    document.getElementById('piVisibility').innerHTML    = '—';
    document.getElementById('piDescription').textContent = '—';
    document.getElementById('piMembers').innerHTML       = '<span style="color:var(--muted);font-size:.8rem">Loading…</span>';
    document.getElementById('piActionRow').style.display = 'none';
    document.getElementById('piBtnRequests').style.display = 'none';
    document.getElementById('piReqCount').style.display    = 'none';
    // Disable join button until details load
    var _joinBtn = document.getElementById('piBtnJoin');
    _joinBtn.disabled = true;
    _joinBtn.onclick  = null;
    infoModal.show();

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'get_project_details', project_id: projectId, username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (!data || !data.success) {
            document.getElementById('piName').textContent = data?.message || 'Failed to load.';
            return;
        }
        var p = data.data;

        document.getElementById('piName').textContent        = p.name;
        document.getElementById('piOwner').textContent       = p.created_by;
        var d = new Date(p.created_at);
        document.getElementById('piCreated').textContent     = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('piDescription').textContent = p.description || '—';

        // Membership status badge
        var statusMap = {
            owner:    '<span class="pi-badge owner"><i class="bi bi-star-fill"></i> Owner</span>',
            accepted: '<span class="pi-badge member"><i class="bi bi-check-circle-fill"></i> Member</span>',
            pending:  '<span class="pi-badge pending"><i class="bi bi-hourglass-split"></i> Pending approval</span>',
            none:     '<span class="pi-badge none"><i class="bi bi-x-circle"></i> Not a member</span>',
        };
        document.getElementById('piStatus').innerHTML = statusMap[p.approval_status] || p.approval_status;

        // Visibility badge
        var vis = p.visibility || 'public';
        document.getElementById('piVisibility').innerHTML = vis === 'public'
            ? '<span class="pi-badge member"><i class="bi bi-globe"></i> Public</span>'
            : '<span class="pi-badge pending"><i class="bi bi-lock-fill"></i> Private</span>';

        // Members list
        var membersContainer = document.getElementById('piMembers');
        var allMembers = [p.created_by].concat(p.members.filter(function(m) { return m !== p.created_by; }));
        var membersHtml = '';
        for (var i = 0; i < allMembers.length; i++) {
            var isOwnerChip = allMembers[i] === p.created_by;
            membersHtml += '<span class="pi-member-chip' + (isOwnerChip ? ' is-owner' : '') + '">'
                         + '<i class="bi bi-person-circle"></i> ' + escapeHTML(allMembers[i])
                         + (isOwnerChip ? ' <small>owner</small>' : '')
                         + '</span>';
        }
        membersContainer.innerHTML = membersHtml || '<span style="color:var(--muted);font-size:.8rem">No members yet.</span>';

        // Action buttons
        var actionRow   = document.getElementById('piActionRow');
        var joinBtn     = document.getElementById('piBtnJoin');
        var reqBtn      = document.getElementById('piBtnRequests');
        var reqCountEl  = document.getElementById('piReqCount');

        actionRow.style.display = '';

        if (p.approval_status === 'owner') {
            // Owner
            joinBtn.style.display = 'none';
            reqBtn.style.display  = '';
            if (p.pending_count && p.pending_count > 0) {
                reqCountEl.textContent    = p.pending_count;
                reqCountEl.style.display  = '';
            } else {
                reqCountEl.style.display = 'none';
            }

        } else if (p.approval_status === 'accepted') {
            // Member: show "Open Project" button
            reqBtn.style.display  = 'none';
            joinBtn.style.display = '';
            joinBtn.disabled      = false;
            joinBtn.innerHTML     = '<i class="bi bi-box-arrow-in-right"></i> Open Project';
            joinBtn.onclick = function() {
                var infoMdl = bootstrap.Modal.getInstance(document.getElementById('projectInfoModal'));
                if (infoMdl) infoMdl.hide();
                var searchBox = document.getElementById('projectSearch');
                if (searchBox && searchBox.value.trim() !== '') {
                    searchBox.value = '';
                    loadProjects().then(function() { _doSelectProject(p.id, p); });
                } else {
                    _doSelectProject(p.id, p);
                }
            };

        } else if (p.approval_status === 'pending') {
            // Already requested
            reqBtn.style.display  = 'none';
            joinBtn.style.display = '';
            joinBtn.disabled      = false;
            joinBtn.innerHTML     = '<i class="bi bi-x-circle"></i> Cancel Request';
            joinBtn.onclick       = function() { cancelJoinRequest(p.id); };

        } else {
            // Non-member show "Join"
            reqBtn.style.display  = 'none';
            joinBtn.style.display = '';
            joinBtn.disabled      = false;
            joinBtn.innerHTML     = '<i class="bi bi-person-plus"></i> Join';
            joinBtn.onclick       = joinFromInfo;
        }

    } catch (err) {
        document.getElementById('piName').textContent = 'Error loading details.';
    }
}

async function joinFromInfo() {
    var projectId = _infoModalProjectId;
    if (!projectId) return;

    var joinBtn = document.getElementById('piBtnJoin');
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Sending…';

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'request_join', project_id: projectId, username: currentUser.username }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            if (data.data && data.data.auto_approved) {
                // Public project
                showToast('Joined project! Opening…', true);
                var infoMdl = bootstrap.Modal.getInstance(document.getElementById('projectInfoModal'));
                if (infoMdl) infoMdl.hide();
                var searchBox = document.getElementById('projectSearch');
                if (searchBox) searchBox.value = '';
                loadProjects().then(function() { _doSelectProject(projectId, null); });
            } else {
                joinBtn.innerHTML = '<i class="bi bi-x-circle"></i> Cancel Request';
                joinBtn.disabled  = false;
                joinBtn.onclick   = function() { cancelJoinRequest(projectId); };
                document.getElementById('piStatus').innerHTML =
                    '<span class="pi-badge pending"><i class="bi bi-hourglass-split"></i> Pending approval</span>';
                showToast('Join request sent! Waiting for owner approval.', true);
                // Clear search and reload sidebar
                var searchBox = document.getElementById('projectSearch');
                if (searchBox) searchBox.value = '';
                loadProjects();
            }
        } else {
            showToast(data?.message || 'Could not send join request.', false);
            joinBtn.disabled = false;
            joinBtn.innerHTML = '<i class="bi bi-person-plus"></i> Join';
        }
    } catch (err) {
        showToast('Network error.', false);
        joinBtn.disabled = false;
        joinBtn.innerHTML = '<i class="bi bi-person-plus"></i> Join';
    }
}

// Called
async function cancelJoinRequest(id) {
    var joinBtn = document.getElementById('piBtnJoin');
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Cancelling\u2026';

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'cancel_join', project_id: id, username: currentUser.username }),
        });
        var data = await res.json();
        if (data.success) {
            showToast('Join request cancelled.', true);
            var infoModalEl = document.getElementById('projectInfoModal');
            var infoMdl = bootstrap.Modal.getInstance(infoModalEl);
            if (infoMdl) infoMdl.hide();
            var searchBox = document.getElementById('projectSearch');
            if (searchBox) searchBox.value = '';
            loadProjects();
        } else {
            showToast(data.message || 'Could not cancel request.', false);
            joinBtn.disabled = false;
            joinBtn.innerHTML = '<i class="bi bi-x-circle"></i> Cancel Request';
        }
    } catch {
        showToast('Network error.', false);
        joinBtn.disabled = false;
        joinBtn.innerHTML = '<i class="bi bi-x-circle"></i> Cancel Request';
    }
}

// Called
function openRequestsFromInfo() {
    var projectId = _infoModalProjectId;
    if (!projectId) return;
    var infoModalEl = document.getElementById('projectInfoModal');
    var infoMdl = bootstrap.Modal.getInstance(infoModalEl);
    if (infoMdl) {
        infoModalEl.addEventListener('hidden.bs.modal', function _onHidden() {
            infoModalEl.removeEventListener('hidden.bs.modal', _onHidden);
            openRequestsModal(projectId);
        });
        infoMdl.hide();
    } else {
        openRequestsModal(projectId);
    }
}

async function toggleVisibility() {
    var btn = document.getElementById('ppBtnVisibility');
    var projectId = currentProjectId;
    var current = btn.dataset.visibility || 'public';
    var newVis = current === 'public' ? 'private' : 'public';

    try {
        var res  = await fetch(API + '?resource=projects', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'set_visibility', project_id: parseInt(projectId), owner: currentUser.username, visibility: newVis }),
        });
        var data = await safeJson(res);
        if (data && data.success) {
            btn.dataset.visibility = newVis;
            document.getElementById('ppVisIcon').className = newVis === 'public' ? 'bi bi-globe' : 'bi bi-lock-fill';
            document.getElementById('ppVisLabel').textContent = newVis === 'public' ? 'Public' : 'Private';
            document.getElementById('ppVisibility').innerHTML = newVis === 'public'
                ? '<span class="pi-badge member"><i class="bi bi-globe"></i> Public</span>'
                : '<span class="pi-badge pending"><i class="bi bi-lock-fill"></i> Private</span>';
            showToast('Visibility changed to ' + newVis + '.', true);
        } else {
            showToast(data?.message || 'Could not change visibility.', false);
        }
    } catch(err) {
        showToast('Network error.', false);
    }
}

async function deleteProject(e, id) {
    e.stopPropagation();
    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    var projName = proj ? proj.name : 'this project';
    var confirmed = await showConfirm({
        type:    'danger',
        icon:    'bi-folder-x',
        title:   'Delete Project?',
        sub:     'You\'re about to permanently delete <strong>' + escapeHTML(projName) + '</strong> and remove all members.',
        warning: 'This cannot be undone. Tasks inside the project will not be deleted.',
        okLabel: 'Delete Project',
        cancelLabel: 'Cancel',
    });
    if (!confirmed) return;

    try {
        var res  = await fetch(API + '?resource=projects&id=' + id, { method: 'DELETE' });
        var data = await safeJson(res);

        if (data && data.success) {
            if (String(currentProjectId) === String(id)) {
                currentProjectId = '';
                document.getElementById('pageTitle').textContent = 'My Tasks';
                document.getElementById('pageSub').textContent   = 'Manage and track your to-dos';
            }
            showToast('Project deleted!', true);
            loadProjects();
            loadTasks();
        } else {
            showToast(data?.message || 'Failed to delete project.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}

async function deleteProjectFromPanel() {
    var id = currentProjectId;
    if (!id) return;

    var proj = allProjects.find(function(p) { return String(p.id) === String(id); });
    var projName = proj ? proj.name : document.getElementById('pageTitle').textContent;

    var confirmed = await showConfirm({
        type:    'danger',
        icon:    'bi-folder-x',
        title:   'Delete Project?',
        sub:     'You\'re about to permanently delete <strong>' + escapeHTML(projName) + '</strong> and remove all members.',
        warning: 'This cannot be undone. Tasks inside the project will not be deleted.',
        okLabel: 'Delete Project',
        cancelLabel: 'Cancel',
    });
    if (!confirmed) return;

    closeProjectPanel();

    try {
        var res  = await fetch(API + '?resource=projects&id=' + id, { method: 'DELETE' });
        var data = await safeJson(res);

        if (data && data.success) {
            currentProjectId = '';
            document.getElementById('pageTitle').textContent = 'My Tasks';
            document.getElementById('pageSub').textContent   = 'Manage and track your to-dos';
            document.getElementById('btnAddTask').style.display     = 'none';
            document.getElementById('btnProjectMenu').style.display = 'none';
            showToast('Project deleted!', true);
            loadProjects();
            loadTasks();
        } else {
            showToast(data?.message || 'Failed to delete project.', false);
        }
    } catch (err) {
        showToast('Network error.', false);
    }
}