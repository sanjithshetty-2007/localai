#include <iostream>

// Definition for singly-linked list.
struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

class Solution {
public:
    ListNode* reverseKGroup(ListNode* head, int k) {
        // Helper function to check if there are at least k nodes left
        auto hasKNodes = [head, k]() {
            ListNode* temp = head;
            for (int i = 0; i < k; ++i) {
                if (!temp) return false;
                temp = temp->next;
            }
            return true;
        };

        // Dummy node to simplify edge cases
        ListNode dummy(0);
        dummy.next = head;
        ListNode* prevGroupTail = &dummy;

        while (hasKNodes()) {
            // Reverse the next k nodes
            ListNode* prev = nullptr;
            ListNode* curr = prevGroupTail->next;
            ListNode* next = nullptr;
            for (int i = 0; i < k; ++i) {
                next = curr->next;
                curr->next = prev;
                prev = curr;
                curr = next;
            }

            // Connect the reversed group to the previous group
            ListNode* nextGroupHead = prevGroupTail->next;
            prevGroupTail->next = prev;
            nextGroupHead->next = curr;

            // Move prevGroupTail to the end of the reversed group
            prevGroupTail = nextGroupHead;
        }

        return dummy.next;
    }
};

// Helper function to print the linked list
void printList(ListNode* head) {
    while (head) {
        std::cout << head->val << " ";
        head = head->next;
    }
    std::cout << std::endl;
}

// Main function for testing
int main() {
    // Create a sample linked list: 1 -> 2 -> 3 -> 4 -> 5
    ListNode* head = new ListNode(1);
    head->next = new ListNode(2);
    head->next->next = new ListNode(3);
    head->next->next->next = new ListNode(4);
    head->next->next->next->next = new ListNode(5);

    Solution solution;
    int k = 2;
    ListNode* result = solution.reverseKGroup(head, k);

    // Print the result: 2 -> 1 -> 4 -> 3 -> 5
    printList(result);

    // Clean up memory
    while (result) {
        ListNode* temp = result;
        result = result->next;
        delete temp;
    }

    return 0;
}
