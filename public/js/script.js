// Global state
let currentQuote = null;
let currentAuthor = null;
let currentImagePath = null;

// DOM elements
const generateBtn = document.getElementById('generateBtn');
const postBtn = document.getElementById('postBtn');
const startAutoBtn = document.getElementById('startAutoBtn');
const stopAutoBtn = document.getElementById('stopAutoBtn');
const resetBtn = document.getElementById('resetBtn');
const viewLogBtn = document.getElementById('viewLogBtn');
const updateIntervalBtn = document.getElementById('updateIntervalBtn');
const intervalInput = document.getElementById('intervalInput');
const hashtagsInput = document.getElementById('hashtagsInput');
const quotePreview = document.getElementById('quotePreview');
const previewQuote = document.getElementById('previewQuote');
const previewAuthor = document.getElementById('previewAuthor');
const quoteDetails = document.getElementById('quoteDetails');
const lastPost = document.getElementById('lastPost');
const totalPosts = document.getElementById('totalPosts');
const totalUsed = document.getElementById('totalUsed');
const totalPosted = document.getElementById('totalPosted');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusBadge = document.getElementById('statusBadge');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const toastIcon = document.getElementById('toastIcon');
const logModal = document.getElementById('logModal');
const logContent = document.getElementById('logContent');
const closeLog = document.getElementById('closeLog');

// API base URL
const API_BASE = '/api';

// Show toast notification
function showToast(message, type = 'success') {
    toast.className = 'toast';
    if (type === 'error') {
        toast.classList.add('error');
        toastIcon.className = 'fas fa-times-circle';
    } else {
        toastIcon.className = 'fas fa-check-circle';
    }
    toastMessage.textContent = message;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// Update status
function updateStatus(status) {
    statusDot.className = 'status-dot';
    if (status === 'running') {
        statusDot.classList.add('running');
        statusText.textContent = 'Running';
        statusBadge.style.borderColor = '#00ff88';
    } else {
        statusDot.classList.add('stopped');
        statusText.textContent = 'Stopped';
        statusBadge.style.borderColor = '#ff4444';
    }
}

// Fetch status
async function fetchStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        
        updateStatus(data.auto_post_enabled ? 'running' : 'stopped');
        lastPost.textContent = data.last_post_time ? new Date(data.last_post_time).toLocaleString() : 'Never';
        totalPosts.textContent = data.total_auto_posts || 0;
        totalUsed.textContent = data.total_used || 0;
        totalPosted.textContent = data.total_posted || 0;
        
        startAutoBtn.disabled = data.auto_post_enabled;
        stopAutoBtn.disabled = !data.auto_post_enabled;
        
        return data;
    } catch (error) {
        console.error('Error fetching status:', error);
        return null;
    }
}

// Generate quote
async function generateQuote() {
    try {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        
        const response = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentQuote = data.quote;
            currentAuthor = data.author;
            currentImagePath = data.image_path;
            
            // Display image
            quotePreview.innerHTML = `<img src="${data.image_base64}" alt="Quote Image">`;
            
            // Display details
            previewQuote.textContent = data.quote;
            previewAuthor.textContent = data.author;
            quoteDetails.style.display = 'block';
            
            postBtn.disabled = false;
            
            showToast('Quote generated successfully!');
        } else {
            showToast(data.error || 'Failed to generate quote', 'error');
        }
    } catch (error) {
        console.error('Generate error:', error);
        showToast('Error generating quote', 'error');
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Generate & Preview';
    }
}

// Post quote
async function postQuote() {
    if (!currentQuote || !currentAuthor) {
        showToast('Generate a quote first', 'error');
        return;
    }
    
    try {
        postBtn.disabled = true;
        postBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';
        
        const hashtags = hashtagsInput.value.split(' ').filter(tag => tag.startsWith('#'));
        
        const response = await fetch(`${API_BASE}/post`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quote: currentQuote,
                author: currentAuthor,
                image_path: currentImagePath,
                hashtags: hashtags,
                is_instant: true
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Quote posted successfully! 🎉');
            await fetchStatus();
            
            // Reset for next quote
            currentQuote = null;
            currentAuthor = null;
            currentImagePath = null;
            postBtn.disabled = true;
            quotePreview.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-quote-left"></i>
                    <p>Generate a quote to preview</p>
                </div>
            `;
            quoteDetails.style.display = 'none';
        } else {
            showToast(data.error || 'Failed to post quote', 'error');
        }
    } catch (error) {
        console.error('Post error:', error);
        showToast('Error posting quote', 'error');
    } finally {
        postBtn.disabled = false;
        postBtn.innerHTML = '<i class="fas fa-share"></i> Post Now';
    }
}

// Start auto-post
async function startAutoPost() {
    try {
        startAutoBtn.disabled = true;
        startAutoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
        
        const response = await fetch(`${API_BASE}/start-auto`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Auto-post started!');
            await fetchStatus();
        } else {
            showToast(data.error || 'Failed to start auto-post', 'error');
        }
    } catch (error) {
        console.error('Start auto error:', error);
        showToast('Error starting auto-post', 'error');
    } finally {
        startAutoBtn.disabled = false;
        startAutoBtn.innerHTML = '<i class="fas fa-play"></i> Start Auto-Post';
    }
}

// Stop auto-post
async function stopAutoPost() {
    try {
        stopAutoBtn.disabled = true;
        stopAutoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stopping...';
        
        const response = await fetch(`${API_BASE}/stop-auto`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Auto-post stopped');
            await fetchStatus();
        } else {
            showToast(data.error || 'Failed to stop auto-post', 'error');
        }
    } catch (error) {
        console.error('Stop auto error:', error);
        showToast('Error stopping auto-post', 'error');
    } finally {
        stopAutoBtn.disabled = false;
        stopAutoBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Auto-Post';
    }
}

// Update interval
async function updateInterval() {
    const interval = parseInt(intervalInput.value);
    
    if (interval < 1) {
        showToast('Interval must be at least 1 minute', 'error');
        return;
    }
    
    try {
        updateIntervalBtn.disabled = true;
        updateIntervalBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
        
        const response = await fetch(`${API_BASE}/update-interval`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Interval updated to ${data.interval} minutes`);
            await fetchStatus();
        } else {
            showToast(data.error || 'Failed to update interval', 'error');
        }
    } catch (error) {
        console.error('Update interval error:', error);
        showToast('Error updating interval', 'error');
    } finally {
        updateIntervalBtn.disabled = false;
        updateIntervalBtn.innerHTML = '<i class="fas fa-save"></i> Update';
    }
}

// View log
async function viewLog() {
    try {
        logModal.style.display = 'block';
        logContent.innerHTML = '<div class="loading">Loading...</div>';
        
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        
        if (data.posts && data.posts.length > 0) {
            logContent.innerHTML = data.posts.map(post => `
                <div class="log-entry">
                    <div class="log-time">${new Date(post.timestamp).toLocaleString()}</div>
                    <div class="log-quote">"${post.quote}"</div>
                    <div class="log-author">— ${post.author}</div>
                    <span class="log-type">${post.type || 'auto'}</span>
                    ${post.postId ? `<div style="font-size:0.8rem;opacity:0.6;margin-top:5px;">ID: ${post.postId}</div>` : ''}
                </div>
            `).join('');
        } else {
            logContent.innerHTML = '<p style="text-align:center;opacity:0.6;">No posts yet</p>';
        }
    } catch (error) {
        console.error('View log error:', error);
        logContent.innerHTML = '<p style="text-align:center;color:#ff4444;">Error loading log</p>';
    }
}

// Reset data
async function resetData() {
    if (!confirm('Are you sure you want to reset all data? This cannot be undone!')) {
        return;
    }
    
    try {
        resetBtn.disabled = true;
        resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
        
        const response = await fetch(`${API_BASE}/reset`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('All data reset successfully');
            await fetchStatus();
            // Clear preview
            quotePreview.innerHTML = `
                <div class="loading-placeholder">
                    <i class="fas fa-quote-left"></i>
                    <p>Generate a quote to preview</p>
                </div>
            `;
            quoteDetails.style.display = 'none';
            postBtn.disabled = true;
        } else {
            showToast(data.error || 'Failed to reset data', 'error');
        }
    } catch (error) {
        console.error('Reset error:', error);
        showToast('Error resetting data', 'error');
    } finally {
        resetBtn.disabled = false;
        resetBtn.innerHTML = '<i class="fas fa-trash"></i> Reset All';
    }
}

// Close log modal
function closeLogModal() {
    logModal.style.display = 'none';
}

// Click outside modal to close
window.addEventListener('click', (e) => {
    if (e.target === logModal) {
        closeLogModal();
    }
});

// Event listeners
generateBtn.addEventListener('click', generateQuote);
postBtn.addEventListener('click', postQuote);
startAutoBtn.addEventListener('click', startAutoPost);
stopAutoBtn.addEventListener('click', stopAutoPost);
updateIntervalBtn.addEventListener('click', updateInterval);
viewLogBtn.addEventListener('click', viewLog);
closeLog.addEventListener('click', closeLogModal);
resetBtn.addEventListener('click', resetData);

// Initial fetch
fetchStatus();

// Refresh status every 30 seconds
setInterval(fetchStatus, 30000);