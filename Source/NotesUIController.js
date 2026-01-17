/**
 * Notes UI Controller Module
 * Handles notes UI initialization and rendering
 */

(function() {
  'use strict';

  class NotesUIController {
    constructor(options = {}) {
      this.notesContainer = options.notesContainer;
      this.notesContent = options.notesContent;
      this.notesList = options.notesList || (options.notesContent ? options.notesContent.querySelector('#notes-list') : null);
      this.noteEmpty = options.noteEmpty || (options.notesContent ? options.notesContent.querySelector('#note-empty') : null);
    }

    async initializeNotesUI() {
      const createNoteButton = document.getElementById('create-note-button');
      const notesFilter = document.getElementById('notes-filter');
      const noteEditorDialog = document.getElementById('note-editor-dialog');
      const noteEditorForm = document.getElementById('note-editor-form');
      const noteTitleInput = document.getElementById('note-title');
      const noteFolderInput = document.getElementById('note-folder');
      const noteContentInput = document.getElementById('note-content');
      
      if (!this.notesContainer || !this.notesList || !createNoteButton) {
        console.warn('[Eureka AI] Notes UI elements not found');
        return;
      }
      
      if (createNoteButton) {
        createNoteButton.addEventListener('click', () => {
          document.getElementById('note-editor-title').textContent = 'New Note';
          if (noteTitleInput) noteTitleInput.value = '';
          if (noteFolderInput) noteFolderInput.value = 'Uncategorized';
          if (noteContentInput) noteContentInput.value = '';
          if (noteEditorForm) {
            delete noteEditorForm.dataset.noteId;
          }
          if (noteEditorDialog) noteEditorDialog.showModal();
        });
      }
      
      if (notesFilter) {
        notesFilter.addEventListener('change', () => {
          this.renderNotes(notesFilter.value);
        });
      }
      
      // Form submission and dialog close handlers are now handled by TabManager
      // when the notes tab is activated - no need to attach them here
      
      await this.renderNotes();
    }

    async renderNotes(folder = 'all') {
      console.log('[NotesUIController] renderNotes called for folder:', folder);
      
      // CRITICAL: Ensure parent #video-info is visible before rendering
      const videoInfo = document.getElementById('video-info');
      if (videoInfo && videoInfo.classList.contains('hidden')) {
        console.warn('[NotesUIController] video-info has hidden class, removing it');
        videoInfo.classList.remove('hidden');
        videoInfo.style.setProperty('display', 'flex', 'important');
        videoInfo.style.setProperty('visibility', 'visible', 'important');
        videoInfo.style.setProperty('opacity', '1', 'important');
      }
      
      console.log('[NotesUIController] SumVidNotesManager available:', !!window.SumVidNotesManager);
      console.log('[NotesUIController] notesList:', !!this.notesList, 'noteEmpty:', !!this.noteEmpty);
      
      if (!window.SumVidNotesManager) {
        console.warn('[NotesUIController] SumVidNotesManager not available');
        return;
      }
      
      if (!this.notesList) {
        console.warn('[NotesUIController] Missing notesList element');
        return;
      }
      
      await window.SumVidNotesManager.loadNotes();
      let notesToShow = folder === 'all' 
        ? window.SumVidNotesManager.getAllNotes()
        : window.SumVidNotesManager.getNotesByFolder(folder);
      
      console.log('[NotesUIController] Notes to show:', notesToShow.length);
      
      notesToShow.sort((a, b) => (b.updatedAt || b.timestamp) - (a.updatedAt || a.timestamp));
      
      if (notesToShow.length === 0) {
        console.log('[NotesUIController] No notes, showing empty state');
        this.notesList.innerHTML = '';
        
        // Remove conflicting inline styles - CSS will handle visibility when tab is active
        if (this.notesContent) {
          this.notesContent.style.removeProperty('display');
          this.notesContent.style.removeProperty('visibility');
          this.notesContent.style.removeProperty('opacity');
          this.notesContent.classList.remove('collapsed', 'hidden');
        }
        
        if (this.noteEmpty) {
          this.noteEmpty.classList.remove('hidden');
        }
        if (this.notesList) {
          this.notesList.classList.add('hidden');
        }
      } else {
        console.log('[NotesUIController] Rendering', notesToShow.length, 'notes');
        
        // Ensure empty state is hidden when notes are displayed
        if (this.noteEmpty) {
          this.noteEmpty.classList.add('hidden');
          this.noteEmpty.style.display = 'none'; // Force hide with inline style
          this.noteEmpty.style.visibility = 'hidden';
          this.noteEmpty.style.opacity = '0';
        }
        
        // Remove conflicting inline styles - CSS will handle visibility
        if (this.notesContent) {
          this.notesContent.style.removeProperty('display');
          this.notesContent.style.removeProperty('visibility');
          this.notesContent.style.removeProperty('opacity');
          this.notesContent.classList.remove('collapsed', 'hidden');
        }
        
        if (this.notesList) {
          this.notesList.classList.remove('hidden');
        }
        
        this.notesList.innerHTML = notesToShow.map(note => {
          const date = new Date(note.updatedAt || note.timestamp);
          return `
            <div class="note-item" data-note-id="${note.id}">
              <div class="note-item__header">
                <h4 class="note-item__title">${note.title}</h4>
                <span class="note-item__date">${date.toLocaleDateString()}</span>
              </div>
              <div class="note-item__content">${note.content.substring(0, 100)}${note.content.length > 100 ? '...' : ''}</div>
              <div class="note-item__actions">
                <button class="note-item__edit" data-note-id="${note.id}">Edit</button>
                <button class="note-item__delete" data-note-id="${note.id}">Delete</button>
              </div>
            </div>
          `;
        }).join('');
        
        // Add event listeners for edit and delete
        this.notesList.querySelectorAll('.note-item__edit').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const noteId = e.target.dataset.noteId;
            const note = notesToShow.find(n => n.id === noteId);
            if (note) {
              document.getElementById('note-editor-title').textContent = 'Edit Note';
              document.getElementById('note-title').value = note.title;
              document.getElementById('note-folder').value = note.folder || 'Uncategorized';
              document.getElementById('note-content').value = note.content;
              document.getElementById('note-editor-form').dataset.noteId = noteId;
              document.getElementById('note-editor-dialog').showModal();
            }
          });
        });
        
        this.notesList.querySelectorAll('.note-item__delete').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const noteId = e.target.dataset.noteId;
            if (confirm('Are you sure you want to delete this note?')) {
              await window.SumVidNotesManager.deleteNote(noteId);
              await this.renderNotes(folder);
            }
          });
        });
      }
    }
  }

  // Export to global scope
  window.NotesUIController = NotesUIController;
})();
