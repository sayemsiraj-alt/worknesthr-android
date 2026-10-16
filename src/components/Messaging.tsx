import { useState, useMemo } from 'react';
import { useData, Message, Employee } from '../context/DataContext';

export function Messaging() {
  const { messages, sendMessage, markMessageRead, deleteMessage, currentUser, employees } = useData();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(messages[0]?.id || null);
  const [replyText, setReplyText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'unread' | 'employees' | 'announcements'>('all');
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(false);

  // New message form state
  const [composeForm, setComposeForm] = useState({
    recipientType: 'employee' as 'employee' | 'all',
    toEmployeeId: '',
    subject: '',
    content: '',
  });

  // Filter messages based on search and type
  const filteredMessages = useMemo(() => {
    return messages.filter(m => {
      const matchSearch =
        m.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.to.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.content || m.preview || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchSearch) return false;

      if (filterType === 'unread') return m.unread;
      if (filterType === 'announcements') return m.to === 'All Employees' || m.to === 'General';
      if (filterType === 'employees') return m.fromEmployeeId && m.fromEmployeeId !== 'admin';
      return true;
    });
  }, [messages, searchQuery, filterType]);

  // Active selected message
  const activeMessage = useMemo(() => {
    return messages.find(m => m.id === selectedThreadId) || filteredMessages[0] || null;
  }, [messages, selectedThreadId, filteredMessages]);

  // Messages related to current thread (same employee or subject)
  const threadMessages = useMemo(() => {
    if (!activeMessage) return [];
    const empId = activeMessage.fromEmployeeId || activeMessage.toEmployeeId;
    const cleanSub = activeMessage.subject.replace(/^Re:\s*/i, '').trim();

    return messages
      .filter(m => {
        if (m.id === activeMessage.id) return true;
        // Same conversation thread by employee ID
        if (empId && (m.fromEmployeeId === empId || m.toEmployeeId === empId)) return true;
        // Or same subject
        const mCleanSub = m.subject.replace(/^Re:\s*/i, '').trim();
        return mCleanSub.toLowerCase() === cleanSub.toLowerCase();
      })
      .sort((a, b) => (a.createdAt || a.id).localeCompare(b.createdAt || b.id));
  }, [messages, activeMessage]);

  const handleSelectMessage = (msg: Message) => {
    setSelectedThreadId(msg.id);
    setMobileShowThread(true);
    if (msg.unread) {
      markMessageRead(msg.id);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !activeMessage) return;

    const recipient = activeMessage.from === (currentUser?.name || 'Admin') ? activeMessage.to : activeMessage.from;
    const targetEmpId = activeMessage.fromEmployeeId === 'admin' ? activeMessage.toEmployeeId : activeMessage.fromEmployeeId;
    const cleanSub = activeMessage.subject.replace(/^Re:\s*/i, '').trim();

    await sendMessage({
      from: currentUser?.name || 'HR Admin',
      fromAvatar: currentUser?.avatar || '👨‍💼',
      fromEmployeeId: 'admin',
      to: recipient,
      toEmployeeId: targetEmpId,
      subject: `Re: ${cleanSub}`,
      content: replyText.trim(),
      unread: true,
    });

    setReplyText('');
  };

  const handleComposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeForm.content.trim()) return;

    let targetName = 'All Employees';
    let targetEmpId = undefined;

    if (composeForm.recipientType === 'employee') {
      const emp = employees.find(e => e.id === composeForm.toEmployeeId);
      if (emp) {
        targetName = emp.name;
        targetEmpId = emp.id;
      } else {
        targetName = 'Employee';
      }
    }

    await sendMessage({
      from: currentUser?.name || 'HR Admin',
      fromAvatar: currentUser?.avatar || '👨‍💼',
      fromEmployeeId: 'admin',
      to: targetName,
      toEmployeeId: targetEmpId,
      subject: composeForm.subject.trim() || 'Notice from HR',
      content: composeForm.content.trim(),
      unread: true,
    });

    setShowComposeModal(false);
    setComposeForm({
      recipientType: 'employee',
      toEmployeeId: '',
      subject: '',
      content: '',
    });
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">Team Messaging &amp; Internal Support</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time internal chat, direct messages with employees, and organization announcements
          </p>
        </div>
        <button
          onClick={() => {
            setComposeForm({
              recipientType: 'employee',
              toEmployeeId: employees[0]?.id || '',
              subject: '',
              content: '',
            });
            setShowComposeModal(true);
          }}
          className="self-start sm:self-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl shadow-xs font-semibold text-xs sm:text-sm flex items-center space-x-2 transition-all cursor-pointer"
        >
          <span>✉️</span>
          <span>+ Compose Message</span>
        </button>
      </div>

      {/* Main Messaging Layout */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-slate-200 overflow-hidden min-h-[560px] flex flex-col md:grid md:grid-cols-12">
        {/* Left column: Message List (hidden on mobile when thread is active) */}
        <div
          className={`md:col-span-5 lg:col-span-4 border-r border-slate-100 flex flex-col ${
            mobileShowThread ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Search & Filter Bar */}
          <div className="p-3 sm:p-4 border-b border-slate-100 space-y-2.5 bg-slate-50/50">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              <input
                type="text"
                placeholder="Search messages or employees..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Filter pills */}
            <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all whitespace-nowrap ${
                  filterType === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({messages.length})
              </button>
              <button
                onClick={() => setFilterType('unread')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all whitespace-nowrap ${
                  filterType === 'unread' ? 'bg-indigo-600 text-white' : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Unread ({messages.filter(m => m.unread).length})
              </button>
              <button
                onClick={() => setFilterType('employees')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all whitespace-nowrap ${
                  filterType === 'employees' ? 'bg-indigo-600 text-white' : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                }`}
              >
                From Staff
              </button>
              <button
                onClick={() => setFilterType('announcements')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all whitespace-nowrap ${
                  filterType === 'announcements' ? 'bg-indigo-600 text-white' : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Broadcasts
              </button>
            </div>
          </div>

          {/* List of Messages */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[580px] thin-scroll">
            {filteredMessages.length === 0 ? (
              <div className="text-center py-12 px-4 text-slate-400">
                <span className="text-3xl block mb-2">💬</span>
                <p className="text-xs sm:text-sm font-semibold text-slate-600">No messages found</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Click "+ Compose Message" to send a direct message or company notice.
                </p>
              </div>
            ) : (
              filteredMessages.map(m => {
                const isSelected = activeMessage?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelectMessage(m)}
                    className={`w-full text-left p-3 sm:p-3.5 transition-all flex items-start space-x-3 cursor-pointer ${
                      isSelected ? 'bg-indigo-50/80 border-l-4 border-indigo-600' : 'hover:bg-slate-50'
                    } ${m.unread ? 'bg-indigo-50/30 font-semibold' : ''}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center text-sm font-bold shrink-0 shadow-xs">
                      {m.fromAvatar || '👤'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-xs truncate ${m.unread ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                          {m.from}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 ml-1">{m.time}</span>
                      </div>
                      <p className={`text-xs truncate ${m.unread ? 'font-bold text-indigo-900' : 'font-medium text-slate-800'}`}>
                        {m.subject}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {m.content || m.preview}
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                          To: {m.to}
                        </span>
                        {m.unread && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 font-bold rounded">
                            New
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Active Conversation Thread */}
        <div
          className={`md:col-span-7 lg:col-span-8 flex flex-col justify-between h-full bg-slate-50/30 ${
            !mobileShowThread ? 'hidden md:flex' : 'flex'
          }`}
        >
          {activeMessage ? (
            <>
              {/* Thread Header */}
              <div className="p-3 sm:p-4 bg-white border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  {/* Mobile Back button */}
                  <button
                    onClick={() => setMobileShowThread(false)}
                    className="md:hidden p-1.5 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    ← Back
                  </button>
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg font-bold shrink-0">
                    {activeMessage.fromAvatar || '👤'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                      {activeMessage.subject}
                    </h3>
                    <p className="text-[11px] text-slate-500 truncate">
                      Between <span className="font-semibold text-slate-700">{activeMessage.from}</span> &amp;{' '}
                      <span className="font-semibold text-slate-700">{activeMessage.to}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => {
                      if (confirm('Delete this message?')) {
                        deleteMessage(activeMessage.id);
                        setSelectedThreadId(null);
                        setMobileShowThread(false);
                      }
                    }}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                    title="Delete message"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Chat Thread Messages */}
              <div className="flex-1 p-3 sm:p-6 overflow-y-auto space-y-4 max-h-[460px] thin-scroll">
                {threadMessages.map(msg => {
                  const isAdmin = msg.fromEmployeeId === 'admin' || msg.from === (currentUser?.name || 'HR Admin');
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center space-x-2 mb-1 px-1">
                        <span className="text-xs font-bold text-slate-700">{msg.from}</span>
                        <span className="text-[10px] text-slate-400">{msg.time}</span>
                      </div>
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 sm:p-4 text-xs sm:text-sm leading-relaxed shadow-xs ${
                          isAdmin
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content || msg.preview}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply Box */}
              <div className="p-3 sm:p-4 bg-white border-t border-slate-100">
                <form onSubmit={handleSendReply} className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder={`Reply to ${
                      activeMessage.from === (currentUser?.name || 'HR Admin')
                        ? activeMessage.to
                        : activeMessage.from
                    }...`}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim()}
                    className="px-4 sm:px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs sm:text-sm transition-all shadow-xs cursor-pointer shrink-0"
                  >
                    <span>Send 🚀</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400">
              <span className="text-4xl block mb-2">📬</span>
              <p className="font-semibold text-slate-600 text-sm">No message selected</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs text-center">
                Select a message from the list or click "+ Compose Message" to start a new chat with an employee.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Compose Message Modal */}
      {showComposeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-lg p-5 sm:p-7 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">✉️</span>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">Compose Internal Message</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowComposeModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleComposeSubmit} className="mt-4 space-y-4">
              {/* Recipient Mode */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Recipient</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setComposeForm(p => ({ ...p, recipientType: 'employee' }))}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      composeForm.recipientType === 'employee'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    👤 Specific Employee
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeForm(p => ({ ...p, recipientType: 'all', toEmployeeId: '' }))}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      composeForm.recipientType === 'all'
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    📢 All Employees (Broadcast)
                  </button>
                </div>

                {composeForm.recipientType === 'employee' && (
                  <select
                    value={composeForm.toEmployeeId}
                    onChange={e => setComposeForm(p => ({ ...p, toEmployeeId: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  >
                    <option value="">-- Select an Employee --</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employeeId}) • {emp.designation} ({emp.department})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  placeholder="e.g. Leave Approval, Attendance Update, Office Announcement"
                  value={composeForm.subject}
                  onChange={e => setComposeForm(p => ({ ...p, subject: e.target.value }))}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              {/* Message Content */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Message Body</label>
                <textarea
                  rows={5}
                  placeholder="Type your official message or instructions here..."
                  value={composeForm.content}
                  onChange={e => setComposeForm(p => ({ ...p, content: e.target.value }))}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed"
                  required
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowComposeModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-xs cursor-pointer"
                >
                  Send Message 🚀
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
