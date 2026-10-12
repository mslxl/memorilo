# Memorilo

Memorilo organizes collaborative notes as nested entries with editable topic content.

## Language

**Note**:
A complete note whose entries, history, and collaborative state change together.
_Avoid_: Workspace, document collection

**NoteEntry**:
A position in a Note's hierarchy occupied by either a Folder or a Topic.
_Avoid_: Page, document node

**Folder**:
A NoteEntry that organizes other entries and has no editor content of its own.
_Avoid_: Empty Topic

**Topic**:
A NoteEntry with editable content that may also organize child entries.
_Avoid_: Page, editor document

**RegularTopic**:
A Topic whose primary content is one rich-text editor. It may be an ordinary authoring Topic or a CardTopic.
_Avoid_: Normal Topic, plain Topic

**BookTopic**:
A Topic bound to one concrete BookFile. It keeps normal editable Topic content while owning that file's reading position and annotations.
_Avoid_: ReadingTopic, book registry entry

**ImageOcclusionTopic**:
A Topic created from either one image in a RegularTopic or one region annotation in a BookTopic. It is a direct child of that source Topic and owns an immutable image snapshot plus the occlusion definitions used to generate Cards.
_Avoid_: Image card, masked RegularTopic

**OcclusionShape**:
One rectangle, ellipse, or brush stroke placed over an ImageOcclusionTopic's image snapshot.
_Avoid_: Mask Card, OcclusionGroup

**OcclusionGroup**:
One or more OcclusionShapes that are hidden and revealed together as one Card.
_Avoid_: OcclusionShape, CardID

**WhiteboardTopic**:
A Topic whose primary editable content is a spatial whiteboard scene with zero or more Embedded Editors. It remains a normal member of the Note hierarchy: it may have a Folder or Topic parent and may organize child Topics.
_Avoid_: Canvas attachment, drawing block

**SpreadsheetTopic**:
A Topic whose primary editable content is one Workbook. It remains a normal member of the Note hierarchy and may organize child Topics.
_Avoid_: Spreadsheet Block, database view, workbook attachment

**Workbook**:
The ordered collection of Sheets owned by exactly one SpreadsheetTopic.
_Avoid_: SpreadsheetTopic, database

**Sheet**:
An ordered two-dimensional arrangement of Rows and Columns inside a Workbook.
_Avoid_: Table view, SpreadsheetTopic

**Cell**:
The data position identified by one SpreadsheetTopic, Sheet, Row, and Column identity.
_Avoid_: Block, A1 address

**CellAddress**:
A display coordinate such as `A1` derived from the current Row and Column order. It is not a Cell's identity.
_Avoid_: CellID, FormulaReference

**FormulaReference**:
A stable reference from a formula to a Cell in a SpreadsheetTopic within the same Note. It may cross SpreadsheetTopic boundaries but never crosses the owning Note aggregate.
_Avoid_: CellAddress, cross-Note link

**Embedded Editor**:
A complete rich-text editor owned by exactly one WhiteboardTopic and positioned by that WhiteboardTopic's scene. A WhiteboardTopic may own multiple independently editable Embedded Editors; they are not Topics and do not appear in the Note hierarchy.
_Avoid_: Child Topic, hidden Topic, WhiteboardTopic document

**Publication**:
Catalog metadata used to discover one or more downloadable renditions of a work. A Publication is not the identity of a BookTopic.
_Avoid_: BookFile, BookTopic

**BookFile**:
The exact readable bytes identified by their format and content hash. Different formats or byte revisions are different BookFiles.
_Avoid_: Publication, reading ID

**ReadingContext**:
The combination of a Note and one of its BookTopics selected when reading a BookFile.
_Avoid_: Reader ID, reading session

**Block**:
A content node inside a Topic.
_Avoid_: NoteEntry, Topic node

**Todo**:
A Block that represents an actionable item with a Todo lifecycle status.
_Avoid_: Task Block, checkbox Block

**Subtask**:
A Todo that has another Todo anywhere in its Block ancestor chain. Its parent in the Todo-only hierarchy is the nearest Todo ancestor.
_Avoid_: Child Todo, nested Todo

**Todo Calendar Feed**:
A read-only calendar subscription that projects eligible Todos into iCalendar events for an external calendar client.
_Avoid_: Todo export file, calendar sync

**Todo Calendar Feed Credential**:
A revocable read-only authorization grant for one account's Todo Calendar Feed, separate from a paired device's synchronization credential.
_Avoid_: Device Token, browser session

**Todo Schedule**:
The explicit scheduling shape of a Todo: no schedule, a deadline, or a time span.
_Avoid_: Due fields, task timing flags

**Todo Occurrence**:
One materialized scheduled instance of a Todo, including an instance generated from a repeat rule.
_Avoid_: Repeat rule, prediction marker

**Todo Calendar Feed Window**:
The bounded rolling date interval used to materialize Todo occurrences for one calendar feed request.
_Avoid_: Fixed calendar export range, subscription snapshot

**Undated Todo Policy**:
The feed rule that either places a Todo without an explicit schedule on the request date or omits it from the feed.
_Avoid_: Journal-date fallback, missing-date behavior

**CardTopic**:
A RegularTopic created from one explicit Card authoring source and placed directly below its source Topic. It owns the learnable Card projection and may either remain linked to its source or become independently editable; a Highlight/Extract alone does not create a CardTopic.
_Avoid_: Card, hidden Card, Card Definition

**Synced CardTopic**:
A CardTopic whose selected content and automatic title still follow its source.
_Avoid_: Mirrored Card, read-only CardTopic

**Detached CardTopic**:
A CardTopic that retains its own editable content and no longer follows later source changes.
_Avoid_: Deleted CardTopic, inactive Card

**Card**:
A learnable item owned by a CardTopic and identified independently from its source Block. Multiple Cards may share one source Block, and each Card keeps a stable CardID across ordinary content edits.
_Avoid_: Block, ClozeGroup

**ClozeGroup**:
One or more hidden content fragments that are revealed together by a Cloze Card. A group may combine rich-content ranges and formula-source fragments, but it is not the Card's identity.
_Avoid_: CardID, Cloze Card

**RichContentCloze**:
A Cloze whose hidden range belongs to a Block's rich content and may include text or embedded elements such as a whole formula.
_Avoid_: TextCloze, WholeMathCloze

**MathSourceCloze**:
A Cloze whose hidden range is a fragment inside a formula's LaTeX source.
_Avoid_: Formula Cloze, RichContentCloze

**ListCard**:
An ordered multi-item Card whose answer items are revealed and evaluated one at a time.
_Avoid_: Set Card, numbered Block

**SetCard**:
An unordered multi-item Card whose answer items are revealed together.
_Avoid_: Basic Card, ListCard, bulleted Block

**Sibling Group**:
All Cards projected from the same Source Block. Siblings remain independently scheduled but may be temporarily withheld from the same learning day by Bury policy.
_Avoid_: Note, Card Definition, shared Learning State

**Highlight**:
An Extract marker applied either to one continuous inline range or to an entire Block. A Highlight can be added to learning as a Reading Item and may later be used to explicitly generate a Card; it is not itself a CardTopic.
_Avoid_: review hint, text color, automatic CardTopic

**Journal**:
The chronological workspace that starts with today's Journal Note and continues into earlier non-empty Journal Notes.
_Avoid_: Daily Notes, diary list

**Journal Note**:
A Note identified by exactly one Journal Date. Its displayed title is derived from that date and is not user-editable.
_Avoid_: Journal entry, dated page

**Journal Date**:
The local calendar date that uniquely identifies a Journal Note, independent of its creation and update timestamps.
_Avoid_: Created date, timestamp

**FSRS Optimizer**:
A reusable FSRS scheduling configuration assigned to Notes. Each Note has one effective FSRS Optimizer, while one FSRS Optimizer may be shared by multiple Notes.
_Avoid_: Deck, scheduler instance

**Global FSRS Optimizer**:
The permanent default FSRS Optimizer used by every Note without an explicit assignment. Its identity and name are fixed, but its scheduling configuration may change.
_Avoid_: Default deck, fallback scheduler

**Rating**:
The outcome selected after reviewing a Review Target: Again, Hard, Good, or Easy.
_Avoid_: Score, grade

**Learning State**:
A Review Target's current scheduling state derived from its retained review history under an FSRS Optimizer.
_Avoid_: Card content, review history

**Inactive Card**:
A Card that is no longer projected from current Note content but retains its review history and Learning State so the same CardID can resume later.
_Avoid_: Deleted Card, suspended Card

**Review Target**:
The smallest learning target that can receive a Rating and have its own Learning State. A regular Card has one whole-card target; a forward ListCard or SetCard instead has item targets identified by stable member Block identity.
_Avoid_: Card projection, review session

**Partial Card**:
A review presentation that asks for one difficult item from a ListCard or SetCard while the complete multi-item Card is temporarily withheld.
_Avoid_: New Card, independent Card Definition

**Bury**:
A queue policy that temporarily withholds an eligible Card or Review Target without changing its Rating history or Learning State.
_Avoid_: Suspend, delete, reschedule

**Archived FSRS Optimizer**:
An FSRS Optimizer that can no longer be assigned to Notes but is retained until database maintenance permanently removes it.
_Avoid_: Deleted Optimizer, disabled scheduler

**Study Day**:
A local learning period whose configurable boundary determines when buried Cards return and daily queue limits reset. It is not necessarily aligned with midnight.
_Avoid_: Calendar day, rolling 24 hours

**Reset Scheduling**:
An explicit restart of a Review Target's Learning State that retains earlier review history while excluding it from subsequent scheduling and optimization.
_Avoid_: Edit Card, delete review history

**Review Event**:
An immutable record of a Rating or scheduling command for one Review Target, retained as the source history from which Learning State is rebuilt.
_Avoid_: Review session, current Card state

**Incremental Learning**:
A learning workflow that interleaves passive processing of source material with active recall, allowing a learner to read, edit, extract, reformulate, and schedule knowledge over multiple sessions.
_Avoid_: Review-only session, read-only flashcard mode

**Reading Item**:
A schedulable unit of source-material processing with a source reference, processing position, priority, and next processing time; it may later produce or update one or more Review Targets.
_Avoid_: Card, Review Target, reading session

**Note Structure**:
The navigable Folder/Topic/CardTopic hierarchy of one Note, shown as context for learning and used to select a learning source without redefining NoteEntry identity.
_Avoid_: Sidebar tree, deck tree, document outline

**Imported Note Copy**:
A Regular Note created by importing a `.memo` snapshot with a newly assigned NoteID and newly assigned globally unique learning identities. It is independent content and does not inherit the source Note's review history.
_Avoid_: Clone, duplicate document, backup restore

**Memo File**:
A private Memorilo interchange file containing one Note's validated snapshot and identity metadata. A Memo File is intended for Memorilo round trips, not public interchange.
_Avoid_: Export archive, database backup

**Personal Learning Sync**:
Account-scoped synchronization of a user's Review Events, Learning States, Optimizer revisions, and assignments across that user's devices; it is separate from collaborative Note content.
_Avoid_: Note collaboration, shared review state

**Paired Device**:
A device with an explicit Memorilo authorization grant for the same user's sync membership. A discovered PeerId is not a Paired Device until its identity and grant are verified.
_Avoid_: Discovered peer, network peer, account session

**Device Display Name**:
User-editable metadata used to recognize a device before, during, and after pairing. It is not a device identity, key, authorization grant, or membership generation.
_Avoid_: Device ID, PeerId, host identity

**Device Version Vector**:
The per-device map of the highest contiguous mutation sequence durably accepted by a Paired Device set. It is the incremental sync cursor for pure P2P learning synchronization, not a server sequence.
_Avoid_: Server cursor, global sync sequence

**Membership Epoch**:
A monotonically increasing generation identifying the authorized Paired Device set and its tombstone/prune boundary. Removing a device advances the epoch; a removed device cannot advance purge progress in a later epoch.
_Avoid_: Sync timestamp, device sequence

**Sync Tombstone**:
A retained marker that tells another device an object or historical record was permanently removed during database maintenance.
_Avoid_: Inactive Card, archive

**Sync Server**:
An optional multi-tenant libp2p peer that devices reach over WebSocket while direct Paired Device synchronization remains available.
_Avoid_: Replacement P2P network, desktop API server

**Relay Sync Mode**:
An account policy in which a Sync Server forwards data only between currently connected devices and does not persist transferred payloads; it cannot recover data while every source device is offline.
_Avoid_: Durable relay, backup service

**Authoritative Sync Mode**:
An account policy in which a Sync Server durably stores plaintext Note, Personal Learning Sync, and asset data as an additional peer and recovery source.
_Avoid_: Relay Sync Mode, opaque backup

**Account**:
A single user's tenant boundary on a Sync Server, owning that user's synchronized Notes, Personal Learning Sync, assets, and device memberships.
_Avoid_: Organization, user session, database

**Account Device**:
An authorized membership binding one local Device to an Account through its PeerId and revocable DeviceCredential.
_Avoid_: Paired Device, discovered peer, browser session

**Active Sync Server Account**:
The one server Account currently bound to a local database for server synchronization; direct Paired Devices remain independent of this binding.
_Avoid_: Primary server, authoritative database

**Sync Frontier**:
A namespace-specific position describing the mutations or CRDT state a sync participant has observed and durably incorporated.
_Avoid_: Sync timestamp, global server cursor

**Sync Generation**:
The account-scoped reset boundary for synchronized content; advancing it invalidates prior cursors and requires clients to bootstrap the namespace again.
_Avoid_: Membership Epoch, database version

**Policy Epoch**:
A monotonically increasing version of an Account's enabled synchronization modes and limits, used to drain sessions that no longer satisfy current policy.
_Avoid_: Sync Generation, protocol version

**Relay Acknowledgement**:
An acknowledgement that a relay accepted a batch for best-effort delivery to currently connected devices; it does not assert durable storage or offline recoverability.
_Avoid_: Durable acknowledgement, authoritative commit
